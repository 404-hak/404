import { useEffect, useRef, useState } from 'react';

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;

/** Число плавно перетекает к новому значению (первый раз — от `from`). */
export function useTween(target: number, ms = 900, from = 0) {
  const [value, setValue] = useState(reducedMotion() ? target : from);
  const current = useRef(value);
  useEffect(() => {
    if (reducedMotion()) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = current.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      current.current = a + (target - a) * easeOutCubic(k);
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** true первые `ms` миллисекунд после появления — для анимации «система включается». */
export function useBooting(ms = 2800) {
  const [booting, setBooting] = useState(!reducedMotion());
  useEffect(() => {
    const t = window.setTimeout(() => setBooting(false), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return booting;
}
