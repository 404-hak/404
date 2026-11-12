import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';

/** Состояние моря по режиму: штиль → зыбь → неспокойная вода. */
const SEA: Record<Mode, { amp: number; chop: number }> = {
  calm: { amp: 1, chop: 0.2 }, alertness: { amp: 1.45, chop: 0.55 }, alarm: { amp: 2.1, chop: 1 }, intercept: { amp: 1.8, chop: 0.8 },
};
/** Отсвет у горизонта: в тревоге — красный, в настороженности — янтарный. */
const GLOW: Record<Mode, [number, number, number, number]> = {
  calm: [122, 134, 111, 0], alertness: [245, 158, 11, 0.09], alarm: [239, 68, 68, 0.16], intercept: [239, 68, 68, 0.12],
};

/** Составляющие волнения: длина волны (м), направление (рад, π/2 — на зрителя), амплитуда (м), фаза. */
// Зыбь идёт наискосок с двух сторон: на каждом срезе воды видны горбы, а не ровная полоса.
const WAVES = [
  { L: 34, dir: 0.62, a: 0.46, p: 0.0, chop: false },
  { L: 22, dir: 2.42, a: 0.32, p: 1.7, chop: false },
  { L: 13, dir: 0.98, a: 0.15, p: 4.1, chop: true },
  { L: 8, dir: 2.12, a: 0.1, p: 2.3, chop: true },
  { L: 9.5, dir: 0.22, a: 0.1, p: 3.6, chop: true },
  { L: 4.6, dir: 1.45, a: 0.04, p: 5.2, chop: true },
].map((w) => {
  const k = (2 * Math.PI) / w.L;
  return { ...w, k, w: Math.sqrt(9.81 * k), cx: Math.cos(w.dir), cz: Math.sin(w.dir) };   // ω = √(gk): длинные волны быстрее
});

const CAM_H = 5.5;     // высота взгляда над водой, м
const D_NEAR = 7;      // ближний гребень у нижнего края, м
const FOAM = [168, 194, 214];

/**
 * Живой фон — ночное море в перспективе. Гребни считаются по физике волн на глубокой воде,
 * ближние закрывают дальние, к горизонту всё тонет в дымке. Лунная дорожка горит настолько,
 * насколько освещена луна этой ночью. Режим меняет состояние моря и отсвет у горизонта.
 * Без движения, если так настроена система; на скрытой вкладке не рисует; на карте — реже.
 */
export default function Ambient({ mode, quiet = false, moon = 0.3 }: { mode: Mode; quiet?: boolean; moon?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, quiet, moon });
  live.current = { mode, quiet, moon };

  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const still = reducedMotion();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0, h = 0, horizon = 0, F = 0, step = 6, raf = 0, last = 0;
    // качество подстраивается само: на слабом устройстве меньше линий и крупнее шаг
    let quality = 1, cost = 0, frames = 0;
    let lines: { y: number; d: number; near: number }[] = [];
    const s = { amp: SEA[live.current.mode].amp, chop: SEA[live.current.mode].chop, glow: [...GLOW[live.current.mode]], moon: live.current.moon };
    let sky: CanvasGradient, sea: CanvasGradient;
    const xs: number[] = [], ys: number[] = [], hs: number[] = [];

    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      horizon = Math.round(h * 0.3);
      F = ((h - horizon) * D_NEAR) / CAM_H;
      step = Math.round((w > 1000 ? 6 : 8) / quality);
      // гребни ровнее по экрану, к горизонту сгущаются; глубина — из перспективы
      const n = Math.round(Math.max(18, Math.min(46, (h - horizon) / 14)) * quality);
      lines = Array.from({ length: n }, (_, i) => {
        const f = (i + 1) / n;
        const y = horizon + (h - horizon + 30) * f ** 1.55;
        return { y, d: (CAM_H * F) / (y - horizon), near: f };
      });
      sky = g.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#070E1B'); sky.addColorStop(1, '#122238');
      sea = g.createLinearGradient(0, horizon, 0, h);
      sea.addColorStop(0, '#0E1C30'); sea.addColorStop(0.35, '#0B1729'); sea.addColorStop(1, '#091323');
    };

    const frame = (t: number) => {
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
      if (!still && t - last < (live.current.quiet ? 125 : 24)) return;
      last = t;
      const started = performance.now();
      const { mode: m, moon } = live.current;
      // плавный переход состояния моря (несколько секунд)
      s.amp += (SEA[m].amp - s.amp) * 0.012;
      s.chop += (SEA[m].chop - s.chop) * 0.012;
      for (let k = 0; k < 4; k++) s.glow[k] += (GLOW[m][k] - s.glow[k]) * 0.02;
      s.moon += (moon - s.moon) * 0.02;
      const time = still ? 0 : t / 1000;
      const cx = w / 2, moonX = w * 0.74;

      // небо, дымка горизонта и отсвет режима
      g.fillStyle = sky; g.fillRect(0, 0, w, horizon + 1);
      g.fillStyle = sea; g.fillRect(0, horizon, w, h - horizon);
      const [gr, gg, gb, ga] = s.glow;
      if (ga > 0.003) {
        const rg = g.createRadialGradient(cx, horizon, 0, cx, horizon, w * 0.7);
        rg.addColorStop(0, `rgba(${gr | 0},${gg | 0},${gb | 0},${ga.toFixed(3)})`);
        rg.addColorStop(1, `rgba(${gr | 0},${gg | 0},${gb | 0},0)`);
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
      }
      const haze = g.createLinearGradient(0, horizon - 26, 0, horizon + 26);
      haze.addColorStop(0, 'rgba(150,180,205,0)'); haze.addColorStop(0.5, 'rgba(150,180,205,.07)'); haze.addColorStop(1, 'rgba(150,180,205,0)');
      g.fillStyle = haze; g.fillRect(0, horizon - 26, w, 52);

      const glints = new Path2D();
      for (const ln of lines) {
        // точки гребня: высота волны и горизонтальный сдвиг (острые гребни, пологие впадины)
        let n = 0;
        for (let x = -24; x <= w + 24; x += step) {
          const xw = ((x - cx) * ln.d) / F;
          let y = 0, dx = 0;
          for (const wv of WAVES) {
            const a = wv.a * s.amp * (wv.chop ? 0.75 + s.chop * 1.2 : 1);
            const ph = wv.k * (xw * wv.cx + ln.d * wv.cz) - wv.w * time + wv.p;
            y += a * Math.sin(ph);
            dx += 0.9 * a * Math.cos(ph) * wv.cx;
          }
          xs[n] = cx + ((xw + dx) * F) / ln.d;
          ys[n] = horizon + ((CAM_H - y) * F) / ln.d;
          hs[n] = y;
          n++;
        }
        // полоса под гребнем закрывает дальние линии — как настоящая вода
        const band = 8 + ln.near * 34;
        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        for (let i = 1; i < n; i++) g.lineTo(xs[i], ys[i]);
        for (let i = n - 1; i >= 0; i--) g.lineTo(xs[i], ys[i] + band);
        g.closePath();
        g.fillStyle = sea; g.fill();

        // сам гребень: к горизонту тоньше и тусклее, у лунной дорожки светлее
        const fog = ln.near ** 0.9;
        const base = 0.035 + 0.2 * fog;
        const lit = s.moon * (0.18 + 0.5 * fog);
        const spread = 30 + 300 * ln.near;
        const grad = g.createLinearGradient(moonX - spread, 0, moonX + spread, 0);
        grad.addColorStop(0, `rgba(${FOAM[0]},${FOAM[1]},${FOAM[2]},${base.toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(226,232,240,${(base + lit).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${FOAM[0]},${FOAM[1]},${FOAM[2]},${base.toFixed(3)})`);
        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        for (let i = 1; i < n; i++) g.lineTo(xs[i], ys[i]);
        g.strokeStyle = grad; g.lineWidth = 0.6 + 0.9 * fog; g.stroke();

        // блики луны на верхушках гребней у дорожки — мерцают сами, потому что гребни бегут
        if (s.moon > 0.05 && ln.near > 0.12) {
          const crest = 0.12 * s.amp;
          for (let i = 1; i < n - 1; i++) {
            if (Math.abs(xs[i] - moonX) < spread * 0.8 && hs[i] > crest && hs[i] >= hs[i - 1] && hs[i] >= hs[i + 1]) {
              const len = 2 + 7 * ln.near;
              glints.moveTo(xs[i] - len, ys[i]); glints.lineTo(xs[i] + len, ys[i]);
            }
          }
        }
      }
      g.strokeStyle = `rgba(240,244,248,${(0.55 * s.moon).toFixed(3)})`;
      g.lineWidth = 1.2; g.lineCap = 'round';
      g.stroke(glints);

      if (!still && !live.current.quiet) {
        cost += performance.now() - started;
        if (++frames === 40) {
          if (cost / frames > 9 && quality > 0.55) { quality -= 0.15; resize(); }
          cost = 0; frames = 0;
        }
      }
    };

    const onVisible = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };
    const onResize = () => { resize(); if (still) frame(0); };
    resize();
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
}
