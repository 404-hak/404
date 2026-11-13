import { useEffect, useRef, useState } from 'react';

/** «Экономный режим» из меню правой кнопки: море, дымка, поплавок и бесконечные анимации стоят — бережёт батарею */
const ECO_KEY = '404-eco';
export const ecoMode = () => { try { return localStorage.getItem(ECO_KEY) === '1'; } catch { return false; } };
export function setEcoMode(on: boolean) {
  try { localStorage.setItem(ECO_KEY, on ? '1' : '0'); } catch { /* только до перезагрузки */ }
  location.reload();     // фоны и петли анимаций запускаются при старте — проще начать заново
}
export const reducedMotion = () =>
  typeof window !== 'undefined' && (ecoMode() || window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

/**
 * Живые поверхности, один обработчик на весь документ:
 * свет под курсором на карточках (.card) и волна от нажатия на главных кнопках (.ink-host).
 */
export function useSurfaces() {
  useEffect(() => {
    if (reducedMotion()) return;
    let lit: HTMLElement | null = null;
    let raf = 0, x = 0, y = 0;
    const paint = () => {
      raf = 0;
      if (!lit) return;
      const r = lit.getBoundingClientRect();
      lit.style.setProperty('--mx', `${x - r.left}px`);
      lit.style.setProperty('--my', `${y - r.top}px`);
    };
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.('.card') as HTMLElement | null;
      if (card !== lit) { lit?.classList.remove('is-lit'); lit = card; lit?.classList.add('is-lit'); }
      x = e.clientX; y = e.clientY;
      if (lit && !raf) raf = requestAnimationFrame(paint);
    };
    const onLeave = () => { lit?.classList.remove('is-lit'); lit = null; };
    const onDown = (e: PointerEvent) => {
      const host = (e.target as Element | null)?.closest?.('.ink-host') as HTMLElement | null;
      if (!host || (host as HTMLButtonElement).disabled) return;
      const r = host.getBoundingClientRect();
      const size = Math.hypot(r.width, r.height) * 2;
      const ink = document.createElement('span');
      ink.className = 'ink';
      ink.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      host.appendChild(ink);
      ink.addEventListener('animationend', () => ink.remove(), { once: true });
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);
}
