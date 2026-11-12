import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';

/** Цвет сети по режиму: шалфей → янтарь → коралл. */
const TINT: Record<Mode, [number, number, number]> = {
  calm: [169, 183, 156], alertness: [245, 170, 60], alarm: [239, 90, 90], intercept: [239, 90, 90],
};
const LINK = 132;     // точки ближе — соединены
const REPEL = 120;    // радиус, в котором точки расступаются от курсора

interface P { x: number; y: number; vx: number; vy: number; r: number; ph: number }

/**
 * Живой фон — «нервная система» заповедника: точки дрейфуют по плавному потоку,
 * соседние соединяются линиями, у курсора расступаются. При тревоге по сети расходится волна.
 * Без анимации, если так настроена система; на скрытой вкладке не рисует.
 */
export default function Ambient({ mode }: { mode: Mode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const pulse = useRef(-1e9);

  useEffect(() => {
    if (modeRef.current !== mode && (mode === 'alarm' || mode === 'alertness')) pulse.current = performance.now();
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const still = reducedMotion();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0;
    let pts: P[] = [];
    const color = [...TINT[modeRef.current]];
    const mouse = { x: -1e4, y: -1e4 };

    const seed = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(24, Math.min(140, Math.round((w * h) / 15000)));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, r: 0.8 + Math.random() * 1.2, ph: Math.random() * Math.PI * 2,
      }));
    };

    const frame = (t: number) => {
      // цвет плавно догоняет цвет режима
      const target = TINT[modeRef.current];
      for (let k = 0; k < 3; k++) color[k] += (target[k] - color[k]) * 0.03;
      const [cr, cg, cb] = color.map(Math.round);
      g.clearRect(0, 0, w, h);

      // волна тревоги от центра
      const age = (t - pulse.current) / 1000;
      const wave = age >= 0 && age < 3.2 ? age * Math.max(w, h) * 0.42 : -1;

      for (const p of pts) {
        if (!still) {
          const a = Math.sin(p.x * 0.0021 + t * 0.00006) * Math.cos(p.y * 0.0024 - t * 0.00005) * Math.PI * 2;
          p.vx += Math.cos(a) * 0.006; p.vy += Math.sin(a) * 0.006;
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < REPEL * REPEL) {
            const f = (1 - Math.sqrt(d2) / REPEL) * 0.08;
            p.vx += dx * f * 0.02; p.vy += dy * f * 0.02;
          }
          p.vx *= 0.96; p.vy *= 0.96;
          p.x += p.vx + Math.cos(a) * 0.12; p.y += p.vy + Math.sin(a) * 0.12;
          if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
        }
      }
      g.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          const alpha = (1 - Math.sqrt(d2) / LINK) * 0.16;
          g.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
      }
      for (const p of pts) {
        let glow = 0;
        if (wave > 0) {
          const dc = Math.hypot(p.x - w / 2, p.y - h / 2);
          glow = Math.exp(-(((dc - wave) / 60) ** 2)) * (1 - age / 3.2);
        }
        const tw = still ? 0.5 : 0.35 + 0.25 * Math.sin(t * 0.0012 + p.ph);
        g.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, tw + glow).toFixed(3)})`;
        g.beginPath(); g.arc(p.x, p.y, p.r + glow * 2, 0, Math.PI * 2); g.fill();
      }
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = mouse.y = -1e4; };
    const onVisible = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };
    const onResize = () => { seed(); if (still) frame(0); };

    seed();
    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
}
