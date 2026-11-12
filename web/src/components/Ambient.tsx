import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';

/** Цвет подсветки по режиму: пена → янтарь → коралл. Сами изобаты всегда морские. */
const TINT: Record<Mode, [number, number, number]> = {
  calm: [190, 214, 200], alertness: [245, 170, 60], alarm: [239, 90, 90], intercept: [239, 90, 90],
};
const SEA: [number, number, number] = [150, 186, 214];
const CELL = 16;          // шаг сетки поля, CSS-пиксели
const LEVELS = 11;        // число изобат
const LIGHT = 230;        // радиус «фонаря» у курсора
const BUCKETS = 5;        // градации яркости линий

/* ---------- гладкий шум для поля глубин ---------- */
const perm = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 404;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
function noise(x: number, y: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const a = perm[X] + Y, b = perm[X + 1] + Y;
  const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
  const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
  return l1 + v * (l2 - l1);
}

interface Ping { x: number; y: number; t0: number; strong: boolean }

/**
 * Живой фон — глубина под водой: изобаты, как на морской карте, медленно перетекают.
 * Время от времени от случайной точки расходится сонарный импульс и подсвечивает линии,
 * курсор — как фонарь под водой. При тревоге импульс идёт из центра в цвете режима.
 * Без движения, если так настроена система; на скрытой вкладке не рисует; на карте — реже.
 */
export default function Ambient({ mode, quiet = false }: { mode: Mode; quiet?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const quietRef = useRef(quiet);
  const pings = useRef<Ping[]>([]);
  quietRef.current = quiet;

  useEffect(() => {
    if (modeRef.current !== mode && (mode === 'alarm' || mode === 'alertness')) {
      const cv = ref.current;
      if (cv) pings.current.push({ x: cv.clientWidth / 2, y: cv.clientHeight / 2, t0: performance.now(), strong: true });
    }
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const still = reducedMotion();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0, h = 0, cols = 0, rows = 0, raf = 0, last = 0, nextPing = performance.now() + 1500;
    let field = new Float32Array(0);
    const tint = [...TINT[modeRef.current]];
    const mouse = { x: -1e4, y: -1e4, on: 0 };

    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL) + 2; rows = Math.ceil(h / CELL) + 2;
      field = new Float32Array(cols * rows);
    };

    const sample = (t: number) => {
      const s = t / 1000;
      for (let j = 0; j < rows; j++) {
        const y = j * CELL;
        const slope = (y / h - 0.5) * 0.9;           // глубже книзу: изобаты ложатся полосами
        for (let i = 0; i < cols; i++) {
          const x = i * CELL;
          field[j * cols + i] = slope
            + 0.62 * noise(x * 0.0026 + s * 0.012, y * 0.0026 - s * 0.007)
            + 0.30 * noise(x * 0.0062 - s * 0.018 + 7.3, y * 0.0062 + s * 0.011 + 3.1);
        }
      }
    };

    const frame = (t: number) => {
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
      // на карте фон почти закрыт — рисуем реже
      if (!still && t - last < (quietRef.current ? 120 : 33)) return;
      last = t;

      const target = TINT[modeRef.current];
      for (let k = 0; k < 3; k++) tint[k] += (target[k] - tint[k]) * 0.05;
      if (!still && t > nextPing) {
        pings.current.push({ x: Math.random() * w, y: Math.random() * h, t0: t, strong: false });
        nextPing = t + 5000 + Math.random() * 5000;
      }
      pings.current = pings.current.filter((p) => t - p.t0 < (p.strong ? 4200 : 5200));
      mouse.on += ((mouse.x > -1e3 ? 1 : 0) - mouse.on) * 0.08;

      sample(still ? 0 : t);
      g.clearRect(0, 0, w, h);

      // подсветка точки: импульсы сонара и фонарь у курсора → 0…1
      const lightAt = (x: number, y: number) => {
        let k = 0;
        const dm = Math.hypot(x - mouse.x, y - mouse.y);
        if (dm < LIGHT) k = Math.max(k, (1 - dm / LIGHT) ** 2 * 0.8 * mouse.on);
        for (const p of pings.current) {
          const age = (t - p.t0) / 1000;
          const r = age * (p.strong ? 420 : 170);
          const band = p.strong ? 70 : 46;
          const d = Math.abs(Math.hypot(x - p.x, y - p.y) - r);
          if (d < band) k = Math.max(k, (1 - d / band) * Math.max(0, 1 - age / (p.strong ? 4.2 : 5.2)));
        }
        return k;
      };

      // изобаты — марширующие квадраты, отрезки раскладываются по яркости
      const paths: Path2D[][] = [Array.from({ length: BUCKETS }, () => new Path2D()), Array.from({ length: BUCKETS }, () => new Path2D())];
      for (let l = 0; l < LEVELS; l++) {
        const iso = -0.95 + (l * 1.9) / (LEVELS - 1);
        const major = l % 3 === 1 ? 1 : 0;           // каждая третья — основная, ярче
        for (let j = 0; j < rows - 1; j++) {
          for (let i = 0; i < cols - 1; i++) {
            const a = field[j * cols + i], b = field[j * cols + i + 1];
            const c = field[(j + 1) * cols + i + 1], d = field[(j + 1) * cols + i];
            const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
            if (idx === 0 || idx === 15) continue;
            const x0 = i * CELL, y0 = j * CELL;
            const top = [x0 + CELL * ((iso - a) / (b - a)), y0];
            const right = [x0 + CELL, y0 + CELL * ((iso - b) / (c - b))];
            const bottom = [x0 + CELL * ((iso - d) / (c - d)), y0 + CELL];
            const left = [x0, y0 + CELL * ((iso - a) / (d - a))];
            const segs: number[][][] = [];
            switch (idx) {
              case 1: case 14: segs.push([left, bottom]); break;
              case 2: case 13: segs.push([bottom, right]); break;
              case 3: case 12: segs.push([left, right]); break;
              case 4: case 11: segs.push([top, right]); break;
              case 5: segs.push([left, top], [bottom, right]); break;
              case 6: case 9: segs.push([top, bottom]); break;
              case 7: case 8: segs.push([left, top]); break;
              case 10: segs.push([left, bottom], [top, right]); break;
            }
            for (const [p, q] of segs) {
              const k = still ? 0 : lightAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
              const bucket = Math.min(BUCKETS - 1, Math.round(k * (BUCKETS - 1)));
              const path = paths[major][bucket];
              path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]);
            }
          }
        }
      }
      for (let major = 0; major < 2; major++) {
        for (let k = 0; k < BUCKETS; k++) {
          const f = k / (BUCKETS - 1);
          const base = major ? 0.2 : 0.1;
          const col = SEA.map((c, n) => Math.round(c + (tint[n] - c) * f));
          g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(base + f * (major ? 0.55 : 0.4)).toFixed(3)})`;
          g.lineWidth = major ? 1.3 : 0.85;
          g.stroke(paths[major][k]);
        }
      }
    };

    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = mouse.y = -1e4; };
    const onDown = (e: PointerEvent) => { if (!still) pings.current.push({ x: e.clientX, y: e.clientY, t0: performance.now(), strong: false }); };
    const onVisible = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };
    const onResize = () => { resize(); if (still) frame(0); };

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
}
