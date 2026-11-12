import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';

const COLOR: Record<Mode, [number, number, number]> = {
  calm: [140, 160, 128], alertness: [245, 158, 11], alarm: [239, 68, 68], intercept: [239, 68, 68],
};
/** Громкость шума воды и сила «мотора» (ритмичные пачки) по режиму. */
const LEVEL: Record<Mode, { noise: number; motor: number }> = {
  calm: { noise: 0.22, motor: 0 }, alertness: { noise: 0.38, motor: 0 }, alarm: { noise: 0.3, motor: 0.7 }, intercept: { noise: 0.3, motor: 0.45 },
};
const COL = 3;        // шаг столбиков, px
const SPEED = 30;     // скорость ленты, px/с

/**
 * Гидрофон — живая звуковая дорожка того, что слышат буи, как у диктофона:
 * тихий шум воды, громче при настороженности; в тревоге — ритмичные пачки мотора.
 */
export default function Hydrophone({ mode }: { mode: Mode | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>(mode ?? 'calm');
  modeRef.current = mode ?? 'calm';

  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const still = reducedMotion();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, prev = 0, acc = 0, lp = 0, slow = 0, clock = 0;
    let buf = new Float32Array(0), head = 0;
    const cur = { ...LEVEL[modeRef.current], col: [...COLOR[modeRef.current]] };

    // следующий отсчёт: отфильтрованный шум под огибающей; мотор — пачки ~2,3 Гц с гармониками
    const next = () => {
      const m = modeRef.current;
      cur.noise += (LEVEL[m].noise - cur.noise) * 0.02;
      cur.motor += (LEVEL[m].motor - cur.motor) * 0.02;
      clock += COL / SPEED;
      lp += (Math.random() * 2 - 1 - lp) * 0.55;
      slow += (Math.random() * 2 - 1 - slow) * 0.04;
      let v = cur.noise * (0.55 + 0.35 * Math.abs(lp) + 0.25 * slow);
      if (cur.motor > 0.01) {
        // ровный ритм ~1,6 Гц: огибающая гладкая, отсчёты не проскакивают пики
        const beat = (0.5 + 0.5 * Math.sin(clock * Math.PI * 2 * 1.6)) ** 2;
        v += cur.motor * beat * (0.8 + 0.2 * Math.abs(lp));
      }
      return Math.min(1, Math.max(0.04, v));
    };
    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.ceil(w / COL) + 2;
      buf = new Float32Array(n);
      for (let i = 0; i < n; i++) buf[i] = next();
      head = 0;
    };
    const draw = (t: number) => {
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
      const dt = prev ? Math.min(0.1, (t - prev) / 1000) : 0;
      prev = t;
      if (!still) {
        acc += dt * SPEED;
        while (acc >= COL) { buf[head] = next(); head = (head + 1) % buf.length; acc -= COL; }
      }
      const m = modeRef.current;
      for (let k = 0; k < 3; k++) cur.col[k] += (COLOR[m][k] - cur.col[k]) * 0.05;
      const [r, gg, b] = cur.col.map(Math.round);
      g.clearRect(0, 0, w, h);
      const fade = g.createLinearGradient(0, 0, w, 0);
      fade.addColorStop(0, `rgba(${r},${gg},${b},0)`);
      fade.addColorStop(0.18, `rgba(${r},${gg},${b},.95)`);
      fade.addColorStop(1, `rgba(${r},${gg},${b},.95)`);
      g.fillStyle = fade;
      const mid = h / 2, half = h / 2 - 0.5, n = buf.length;
      // новые отсчёты появляются справа и уезжают влево
      for (let i = 0; i < n; i++) {
        const v = buf[(head + i) % n];
        const x = i * COL - acc;
        const bh = Math.max(0.5, v * half);
        g.fillRect(x, mid - bh, 2, bh * 2);
      }
    };
    const onVisible = () => { if (!document.hidden && !still) { prev = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } };
    const onResize = () => { resize(); if (still) draw(0); };
    resize();
    raf = requestAnimationFrame(draw);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="h-5 w-[72px]" />;
}
