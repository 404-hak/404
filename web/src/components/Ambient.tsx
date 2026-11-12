import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';
import Reeds from './Reeds';
import { HZ } from '../theme';
import { SPEED, createSea, follow, frameFrom, lerp3, seaClock, targets, trackBody } from '../sea';
import { introCovering } from '../introBus';

/**
 * Живой фон — море дельты под настоящим небом. В «Авто» солнце и луна идут по своим дугам
 * в реальном времени (МСК), небо и вода плавно перетекают: ночь → сумерки → золотой час → день.
 * При движении мыши по воде бежит свет за курсором; клик пускает волну. Режим подкрашивает море
 * (настороженность — янтарь, тревога — красный) и ускоряет волны.
 * Без видеокарты или при «уменьшить движение» — тихий запасной фон.
 */
const PAL_KEYS = ['top', 'hz', 'far', 'near', 'line', 'isle', 'sun'] as const;

export default function Ambient({ mode, quiet = false, moon = 0.5 }: { mode: Mode; quiet?: boolean; moon?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, quiet, moon });
  const pulse = useRef<{ x: number; y: number; t0: number; k: number } | null>(null);
  live.current = { mode, quiet, moon };

  useEffect(() => {
    if (mode === 'alarm' || mode === 'alertness') pulse.current = { x: 0.5, y: 0.35, t0: performance.now(), k: mode === 'alarm' ? 1 : 0.6 };
  }, [mode]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const force = new URLSearchParams(location.search).has('sea');   // для проверки на машине без видеокарты
    let sea: ReturnType<typeof createSea> = null;
    try { sea = reducedMotion() ? null : createSea(cv, force); } catch { sea = null; }
    if (!sea) { cv.style.display = 'none'; cv.parentElement?.classList.add('still'); return; }
    const gfx = sea;

    let w = 0, h = 0, raf = 0, prev = 0, slow = 0, quietAt = 0, cap = 0, lowered = false, ready = false;
    const startAt = performance.now();
    // цели неба (светила по настоящему времени, палитра) — 4 раза в секунду: солнце и луна за это время
    // сдвигаются на доли пикселя, а расчёт положения светил каждый кадр стоил заметно
    let tg = targets(live.current.mode, live.current.moon), tgAt = 0, tgKey = '';
    const f = { ...frameFrom(tg, HZ), speed: 1 };
    const fadeSun = { on: false }, fadeMoon = { on: false };
    const ptr = { tx: 0.5, ty: 0.5, moved: -1e9 };

    const resize = () => { w = innerWidth; h = innerHeight; gfx.resize(w, h); };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { prev = 0; return; }
      const { mode: m, quiet: q, moon: mp } = live.current;
      // кадры: вода движется медленно — в покое 30 в секунду (глазу не отличить, видеокарте вдвое легче);
      // пока двигается мышь, идёт волна или открывается страница — до 60 (не чаще, даже на мониторе 144 Гц);
      // на карте фон почти закрыт — 12; если компьютер не успевает — 30 всегда, потом меньше точек
      const busy = now - ptr.moved < 2200 || pulse.current != null || now - startAt < 2500;
      const gap = q ? 80 : Math.max(cap, busy ? 1000 / 60 : 1000 / 30);
      if (now - quietAt < gap - 3) return;
      quietAt = now;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 1 / 60;
      prev = now;
      if (introCovering()) { f.t = seaClock(); return; }  // под заставкой не рисуем; вода — по общим часам
      if (!ready) {                                        // шейдер собирается в фоне — страница не замирает
        const st = gfx.status();
        if (st === 'fail') { cancelAnimationFrame(raf); cv.style.display = 'none'; cv.parentElement?.classList.add('still'); return; }
        if (st === 'pending') return;
        ready = true;
        cv.parentElement?.classList.add('has-water');
      }

      f.speed += (SPEED[m] - f.speed) * follow(0.6, dt);
      f.t += dt * f.speed;
      // цвета неба и воды мягко идут к цели (смена режима и темы); светила — точно по дуге
      const key = `${m}|${mp}`;
      if (now - tgAt > 250 || key !== tgKey) { tg = targets(m, mp); tgAt = now; tgKey = key; }
      const kc = follow(1.2, dt);
      for (const n of PAL_KEYS) lerp3(f.pal[n], tg.pal[n], kc);
      lerp3(f.moonC, tg.moonC, kc);
      lerp3(f.beacon, tg.beacon, kc);
      f.dark += (tg.dark - f.dark) * kc;
      f.pal.stars += (tg.pal.stars - f.pal.stars) * kc;
      f.pal.clouds += (tg.pal.clouds - f.pal.clouds) * kc;
      trackBody(f.sun, tg.sun, fadeSun, dt);
      trackBody(f.moon, tg.moon, fadeMoon, dt);
      // свет за курсором — только пока мышь двигается
      const moving = now - ptr.moved < 2200;
      const k = follow(4, dt);
      f.ptr[0] += (ptr.tx - f.ptr[0]) * k;
      f.ptr[1] += (ptr.ty - f.ptr[1]) * k;
      f.power += ((moving ? 1 : 0) - f.power) * follow(2, dt);
      const a = Math.min(1, (now - startAt) / 1800);
      f.gain = 1 - (1 - a) ** 3;
      const p = pulse.current;
      if (p) {
        const age = (now - p.t0) / 1000;
        if (age > 3.5) pulse.current = null;
        f.pulse = [p.x, p.y, age, p.k];
      } else f.pulse = [0, 0, 0, 0];
      gfx.draw(f);

      // не успеваем (кадр заметно дольше задуманного): сначала 30 кадров всегда, потом меньше точек
      if (!q && !lowered) {
        slow = dt * 1000 > gap * 1.5 + 4 ? slow + 1 : Math.max(0, slow - 2);
        if (slow > 40) { slow = 0; if (!cap) cap = 33; else { gfx.lower(w, h); lowered = true; } }
      }
    };

    const onMove = (e: PointerEvent) => { ptr.tx = e.clientX / innerWidth; ptr.ty = e.clientY / innerHeight; ptr.moved = performance.now(); };
    const onDown = (e: PointerEvent) => {
      if (live.current.quiet) return;
      pulse.current = { x: e.clientX / innerWidth, y: 1 - e.clientY / innerHeight, t0: performance.now(), k: 0.7 };
    };
    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      gfx.dispose();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <div aria-hidden className="sea pointer-events-none fixed inset-0">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      <div className="mist" />
      <Reeds side="left" seed={5} count={13} className="reeds reeds-left" clump blur={1.6} />
      <Reeds side="right" seed={17} count={13} className="reeds reeds-right" clump blur={1.6} />
    </div>
  );
}
