import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';

const COLOR: Record<Mode, [number, number, number]> = {
  calm: [122, 134, 111], alertness: [245, 158, 11], alarm: [239, 68, 68], intercept: [239, 68, 68],
};
/** Амплитуда шума воды и пачек «мотора» по режиму. */
const LEVEL: Record<Mode, { a: number; burst: number }> = {
  calm: { a: 1.1, burst: 0 }, alertness: { a: 2, burst: 0 }, alarm: { a: 1.6, burst: 5.5 }, intercept: { a: 1.6, burst: 3 },
};

/**
 * Осциллограмма гидрофона вместо границы шапки: что сейчас «слышат» буи.
 * Спокойно — тихий шум воды, настороженность — громче, тревога — пачки всплесков, как мотор.
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
    let w = 0, h = 0, raf = 0, last = 0;
    const cur = { a: LEVEL[modeRef.current].a, burst: LEVEL[modeRef.current].burst, col: [...COLOR[modeRef.current]] };

    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (t: number) => {
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
      if (!still && t - last < 33) return;
      last = t;
      const m = modeRef.current;
      cur.a += (LEVEL[m].a - cur.a) * 0.06;
      cur.burst += (LEVEL[m].burst - cur.burst) * 0.06;
      for (let k = 0; k < 3; k++) cur.col[k] += (COLOR[m][k] - cur.col[k]) * 0.06;
      const [r, gg, b] = cur.col.map(Math.round);
      g.clearRect(0, 0, w, h);
      const mid = h / 2, shift = still ? 0 : t / 22;

      // тонкая линия-основа и сама осциллограмма, по краям гаснет
      const fadeX = g.createLinearGradient(0, 0, w, 0);
      fadeX.addColorStop(0, `rgba(${r},${gg},${b},0)`);
      fadeX.addColorStop(0.08, `rgba(${r},${gg},${b},.9)`);
      fadeX.addColorStop(0.92, `rgba(${r},${gg},${b},.9)`);
      fadeX.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = `rgba(${r},${gg},${b},.22)`;
      g.fillRect(0, mid, w, 1);
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const u = x + shift;
        let y = cur.a * (0.55 * Math.sin(u * 0.13) + 0.3 * Math.sin(u * 0.41 + 1.3) + 0.2 * Math.sin(u * 0.97 + 0.4));
        if (cur.burst > 0.05) y += cur.burst * Math.max(0, Math.sin(u * 0.012)) ** 12 * Math.sin(u * 0.85);
        if (x === 0) g.moveTo(x, mid + y); else g.lineTo(x, mid + y);
      }
      g.strokeStyle = fadeX;
      g.lineWidth = 1.2;
      g.stroke();
    };
    const onVisible = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } };
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

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-[7px] z-30 h-[14px] w-full" />;
}
