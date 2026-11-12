import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SeaSound } from '../introSound';
import { useSoundOn } from '../sound';
import { ReedsImage } from './Reeds';
import { HZ, currentSky, type Sky } from '../theme';
import { hex, palAt, type V3 } from '../skyPalette';
import { createSea, frameFrom, introCover, seaClock, targets, type Frame, type Sea } from '../sea';

/**
 * Интро: то же море, что на фоне сайта (один рисовальщик, sea.ts), только ракурс ниже и с бликом
 * объектива от солнца или луны. Камера наводит резкость, знак падает, как поплавок, — смаз движения,
 * бульк, по воде расходится волна, брызги штрихами, круги и пузыри; щит покачивается и отражается;
 * буй подаёт сигнал, из размытия проявляется «404 · Браконьер не найден». В конце камера опускает
 * взгляд к воде — горизонт встаёт туда, где он на фоне, и сцена растворяется в дашборде.
 * Стартует сам. Звук — если браузер разрешит; иначе по первому касанию (кнопка «Включить звук»).
 * Без видеокарты — та же сцена в SVG.
 */

const W = 1600, H = 900, HORIZON = 470, WATER = 610, CX = 800;
const MARK_RATIO = 819.83 / 1250;        // ширина / высота знака (brand/src/mark-data.mjs)
const MH = 210, MW = MH * MARK_RATIO;
const SETTLED = WATER - 0.8 * MH;         // в покое над водой щит и крылья, игла — под водой
const START = -MH - 60, IMPACT = WATER - MH;
const T_IN = 1.1, T_DROP = 0.7, FALL = 0.8, T_HIT = T_DROP + FALL;
const T_PING = 2.8, T_WORD = 3.2, T_TAG = 3.8, T_OUT = 5.8, OUT = 0.9;
/** Палитра интро из настоящего неба темы: в «Авто» — время суток по МСК, солнце или луна на своих местах */
const css = (c: V3) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;
const mixV = (a: V3, b: V3, k: number) => a.map((v, i) => v + (b[i] - v) * k) as V3;
/** Светило не прячем за надписью «404»: в интро сдвигаем его за край названия (в фоне — точное место) */
const clearOfTitle = (x: number, y: number) => (y < 360 && Math.abs(x - CX) < 290 ? CX + (x >= CX ? 1 : -1) * 290 : x);

/** Видимая по ширине часть кадра (на узком экране «slice» обрезает края) */
function visibleX(vw: number, vh: number) {
  const s = Math.max(vw / W, vh / H), ox = (vw - W * s) / 2;
  return [Math.max(0, -ox / s), Math.min(W, (vw - ox) / s)];
}
/**
 * Светило на небе интро: та же дуга, что на фоне (theme.toScreen), только неба в кадре больше.
 * По ширине — в видимой части кадра, чтобы на телефоне солнце и луна не уходили за край.
 */
function introBody(x: number, y: number, vw = innerWidth, vh = innerHeight) {
  const [x0, x1] = visibleX(vw, vh), m = (x1 - x0) * 0.0875;
  const by = HORIZON - ((y - HZ) / 0.13) * (HORIZON - 120);   // ниже нуля — за горизонтом, скрыто водой
  const bx = x0 + m + x * (x1 - x0 - 2 * m);
  return { x: x1 - x0 > 900 ? clearOfTitle(bx, by) : bx, y: by };
}
/** Кадр интро (viewBox, обрезка «slice») → доли экрана для шейдера, y — снизу */
function viewMap(vw: number, vh: number) {
  const s = Math.max(vw / W, vh / H), ox = (vw - W * s) / 2, oy = (vh - H * s) / 2;
  const toUv = (x: number, y: number) => [(ox + x * s) / vw, 1 - (oy + y * s) / vh];
  return { toUv, hz: toUv(0, HORIZON)[1] };
}

function buildPalette(sky: Sky, moon: number) {
  const p = palAt(sky.sunAlt);
  const light = sky.ui >= 0.5;
  const useSun = sky.sun.visible >= sky.moon.visible && sky.sun.visible > 0.2;
  const b = useSun ? sky.sun : sky.moon;
  const seen = useSun ? sky.sun.visible : sky.moon.visible;
  const skyBands = [0, 1, 2, 3].map((i) => css(mixV(p.hz, p.top, i / 3)));
  const { x: bx, y: by } = introBody(b.x, b.y);
  const band = skyBands[Math.min(3, Math.floor(((HORIZON - by) / HORIZON) * 4))];
  return {
    light, skyBands, band,
    skyTop: css(p.top), skyMid: css(mixV(p.hz, p.top, 0.45)), skyHz: css(p.hz), seaFar: css(p.far), seaNear: css(p.near),
    seaBands: [0, 1, 2, 3].map((i) => css(mixV(p.far, p.near, i / 3))),
    line: css(p.line), island: css(p.isle), stars: p.stars, horizon: css(mixV(p.hz, [1, 1, 1], 0.35)),
    body: seen > 0.05 ? { x: bx, y: by, sun: useSun, seen, illum: sky.moon.illum >= 0 ? sky.moon.illum : moon, waxing: sky.moon.waxing } : null,
    bodyC: useSun ? css(p.sun) : css(mixV(hex('#F2C79A'), hex('#EEF1F8'), Math.min(1, Math.max(0, sky.moon.alt / 14)))),
    primary: '#FFFFFF', accent: light ? '#5E6A57' : '#8E9C80', muted: light ? '#505968' : '#B4BAC4',
    vignette: 0.12 + 0.4 * (1 - sky.day),
    reedMid: css(mixV(hex('#07101F'), hex('#4A5A42'), sky.day)), reedNear: css(mixV(hex('#02060D'), hex('#25311F'), sky.day)),
    fade: getComputedStyle(document.documentElement).getPropertyValue('--rgb-bg').trim() || '11 22 40',
    mark: light ? '/brand/404-logo-dark.svg' : '/brand/404-logo-cream.svg',
    word: light ? '/brand/404-wordmark-dark.svg' : '/brand/404-wordmark-cream.svg',
  };
}

/** Размытие камыша в единицах рисунка (высота 500) из пикселей на экране при высоте куста vh% */
const reedBlur = (px: number, vh: number) => Math.round((px * 500) / ((vh / 100) * innerHeight) * 10) / 10;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Затухающие колебания поплавка после удара о воду */
function bobTop(tau: number) {
  const w = 7, z = 0.32, wd = w * Math.sqrt(1 - z * z);
  const x0 = IMPACT - SETTLED, v0 = 520;
  return SETTLED + Math.exp(-z * w * tau) * (x0 * Math.cos(wd * tau) + ((v0 + z * w * x0) / wd) * Math.sin(wd * tau));
}
function markTop(t: number) {
  if (t < T_HIT) return START + (IMPACT - START) * ((t - T_DROP) / FALL) ** 2;
  const tau = t - T_HIT;
  return bobTop(tau) + 3 * Math.sin(1.6 * t) * (1 - Math.exp(-tau));
}
function markTilt(t: number) {
  if (t < T_HIT) return 5 * Math.sin((t - T_DROP) * 4);
  const tau = t - T_HIT;
  return 7 * Math.exp(-1.4 * tau) * Math.sin(6 * tau) + 1.2 * Math.sin(1.3 * t);
}

/** ?introAt=3.5 — стоп-кадр интро на нужной секунде (скриншоты для слайдов) */
function frozenAt(): number | null {
  try {
    const v = new URLSearchParams(location.search).get('introAt');
    return v != null && v !== '' && !Number.isNaN(+v) ? +v : null;
  } catch {
    return null;
  }
}

function useScene() {
  return useMemo(() => {
    const r = rng(404);
    const stars = Array.from({ length: 80 }, () => ({ x: r() * W, y: r() * (HORIZON - 40), s: 0.5 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 1.6 }));
    const glints = Array.from({ length: 52 }, () => ({ y: HORIZON + 6 + r() ** 1.6 * (H - HORIZON), ph: r() * 6.28, sp: 1 + r() * 2.5, j: r() }));
    const streaks = Array.from({ length: 30 }, () => ({ x: r() * W, y: HORIZON + 8 + r() ** 1.3 * (H - HORIZON), l: 30 + r() * 130, sp: 4 + r() * 10, o: 0.03 + r() * 0.07 }));
    const drops = Array.from({ length: 26 }, () => {
      const a = (25 + r() * 130) * (Math.PI / 180);
      return { vx: Math.cos(a) * (180 + r() * 380), vy: -Math.sin(a) * (300 + r() * 440), r: 1.4 + r() * 2.8 };
    });
    const bubbles = Array.from({ length: 9 }, (_, i) => ({ t: T_HIT + 0.15 + i * 0.14 + r() * 0.12, dx: (r() - 0.5) * MW * 0.9, f: 600 + r() * 500 }));
    const shore = (x0: number, x1: number) => {
      let d = `M${x0},${HORIZON + 2}`;
      for (let x = x0; x <= x1; x += 18) d += ` L${x},${HORIZON - 3 - r() * 9 - (r() < 0.12 ? 7 : 0)}`;
      return d + ` L${x1},${HORIZON + 2} Z`;
    };
    const islands = [shore(-20, 560), shore(1060, 1300), shore(1380, 1620)];
    return { stars, glints, streaks, drops, bubbles, islands };
  }, []);
}

export default function Intro({ onDone, moon = 0.3 }: { onDone: () => void; moon?: number }) {
  const scene = useScene();
  const soundOn = useSoundOn();
  const [C] = useState(() => buildPalette(currentSky(), moon));   // небо на момент показа
  const moonRef = useRef(moon);
  moonRef.current = moon;
  const cvRef = useRef<HTMLCanvasElement>(null);
  const sea = useRef<{ gfx: Sea; f: Frame } | null>(null);
  const [gl, setGl] = useState<boolean | null>(null);
  const [t, setT] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const born = useRef(performance.now());
  const sound = useRef<SeaSound | null>(null);
  const scheduled = useRef(false);
  const done = useRef(false);

  const freeze = useRef(frozenAt());
  const now = () => freeze.current ?? (performance.now() - born.current) / 1000;

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    sound.current?.fadeOut(0.6);
    window.setTimeout(onDone, 50);
  }, [onDone]);

  const skip = () => {
    // «Пропустить» — сразу к растворению сцены
    if (now() < T_OUT) born.current = performance.now() - T_OUT * 1000;
  };

  // море — тем же рисовальщиком, что фон сайта; сам фон под заставкой пока не рисует
  useLayoutEffect(() => {
    introCover.on = true;
    let gfx: Sea | null = null;
    try { gfx = cvRef.current ? createSea(cvRef.current, new URLSearchParams(location.search).has('sea'), 0.45) : null; } catch { gfx = null; }
    setGl(!!gfx);
    if (!gfx) return () => { introCover.on = false; };
    const g = gfx;
    sea.current = { gfx: g, f: { ...frameFrom(targets('calm', moonRef.current), HZ), gain: 1 } };
    const resize = () => g.resize(innerWidth, innerHeight);
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); g.dispose(); sea.current = null; introCover.on = false; };
  }, []);

  /** Кадр моря: ракурс интро; в конце взгляд опускается к воде — горизонт и светила встают как на фоне */
  const drawSea = (tt: number) => {
    const st = sea.current;
    if (!st) return;
    const f = st.f;
    const v = viewMap(innerWidth, innerHeight);
    const k = ease((tt - T_OUT) / OUT);
    f.hz = v.hz + (HZ - v.hz) * k;
    const tg = targets('calm', moonRef.current);
    Object.assign(f, { pal: tg.pal, moonC: tg.moonC, dark: tg.dark, beacon: tg.beacon });
    // светила заставки гаснут в начале растворения: под ней уже фон со своими солнцем и луной — не двоятся
    const gone = 1 - ease((tt - T_OUT) / (OUT * 0.35));
    const place = (b: number[]) => {
      const p = introBody(b[0], b[1]);
      const [ux, uy] = v.toUv(p.x, p.y);
      return [ux + (b[0] - ux) * k, uy + (b[1] - uy) * k, b[2] * gone, b[3]];
    };
    f.sun = place(tg.sun);
    f.moon = place(tg.moon);
    f.bodyK = 1.4 - 0.4 * k;                     // в интро светила крупнее — ближе к кадру
    f.flare = 1 - k;                             // блик объектива — только в заставке
    const tau = tt - T_HIT;
    const [ix, iy] = v.toUv(CX, WATER);
    f.pulse = tau > 0 && tau < 4.5 ? [ix, iy + (f.hz - v.hz), tau, 0.9] : [0, 0, 0, 0];   // волна от удара поплавка
    f.t = freeze.current ?? seaClock();
    const blur = 16 * (1 - easeOut(tt / T_IN));               // наводка резкости; в конце море резкое, как фон под ним
    st.gfx.setScale(0.45 * Math.max(0.12, 1 / (1 + blur * 0.35)));
    st.gfx.draw(f);
  };

  // анимация
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const tt = now();
      setT(tt);
      drawSea(tt);
      if (tt >= T_OUT) introCover.on = false;     // сцена растворяется — под ней уже живой фон
      if (tt >= T_OUT + OUT && freeze.current == null) finish();
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [finish]); // eslint-disable-line react-hooks/exhaustive-deps

  // звук: пробуем сразу; если браузер не разрешил — по первому касанию, с текущего момента сцены
  useEffect(() => {
    if (!soundOn || freeze.current != null) return;
    let s: SeaSound;
    try { s = new SeaSound(); } catch { return; }
    sound.current = s;
    const schedule = () => {
      if (scheduled.current || done.current) return;
      scheduled.current = true;
      setNeedsTap(false);
      const at = now();
      const ev = (time: number, fn: (when: number) => void) => { if (time >= at - 0.05) fn(s.at(Math.max(0, time - at))); };
      s.startWaves();
      if (at < T_HIT) ev(T_DROP + 0.05, (w) => s.whoosh(w, Math.max(0.1, T_HIT - Math.max(at, T_DROP + 0.05))));
      ev(T_HIT, (w) => s.plop(w));
      scene.bubbles.forEach((b) => ev(b.t, (w) => s.bubble(w, b.f)));
      ev(T_PING, (w) => s.ping(w));
    };
    void s.resume().then((ok) => { if (ok) schedule(); else if (!done.current) setNeedsTap(true); });
    const unlock = () => { void s.resume().then((ok) => ok && schedule()); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [soundOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- кадр ----------
  const T = t;                                   // время сцены
  const fallen = t >= T_DROP;
  const tau = t - T_HIT;
  const top = fallen ? markTop(t) : START;
  const tilt = fallen ? markTilt(t) : 0;
  // смаз движения: при падении — по скорости, после удара — по скорости покачивания
  const vy = t < T_HIT ? (2 * (IMPACT - START) * ((t - T_DROP) / FALL)) / FALL : Math.abs(markTop(t + 0.01) - markTop(t)) * 100;
  const motionBlur = fallen ? Math.min(11, vy * 0.0068) : 0;

  // камера: наводка резкости в начале, растворение в конце
  const inK = easeOut(t / T_IN), outK = ease((t - T_OUT) / OUT);
  const camBlur = 16 * (1 - inK) + 14 * outK;
  const camScale = 1.04 - 0.04 * inK + 0.05 * outK;
  const camOpacity = inK * (1 - outK);
  const viewScale = Math.max(innerWidth / W, innerHeight / H);
  const midBlur = gl && camBlur > 0.2 ? { filter: `blur(${camBlur}px)` } : undefined;

  const markG = (
    <g transform={`rotate(${tilt} ${CX} ${WATER}) translate(${CX - MW / 2} ${top})`}>
      <image href={C.mark} width={MW} height={MH} />
    </g>
  );
  const wordK = ease((t - T_WORD) / 1.0), tagK = ease((t - T_TAG) / 0.9);
  // взгляд вниз в конце: всё, что стоит на воде, поднимается вместе с горизонтом
  const lift = gl ? (HZ - viewMap(innerWidth, innerHeight).hz) * outK * innerHeight : 0;
  const fb = C.body && C.body.y < HORIZON - 8 ? C.body : null;     // светило над горизонтом — есть блик

  return (
    <div role="dialog" aria-label="Заставка 404" className="fixed inset-0 z-[3000] overflow-hidden"
      style={{ background: `rgb(${C.fade} / ${1 - outK})` }}>
      {/* камера: масштаб и прозрачность — на видеокарте; расфокус моря — мельче холст, сцены поверх — SVG-размытие
          только по её содержимому (CSS-размытие всего экрана каждый кадр и давало лаги) */}
      <div className="absolute inset-0" style={{ filter: gl === false && camBlur > 0.2 ? `blur(${camBlur}px)` : undefined, transform: `scale(${camScale})`, opacity: camOpacity }}>
        <canvas ref={cvRef} className="absolute inset-0 h-full w-full" style={{ display: gl === false ? 'none' : undefined }} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden
          style={{ transform: lift ? `translateY(${-lift}px)` : undefined }}>
          <defs>
            <linearGradient id="i-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.skyTop} /><stop offset="0.55" stopColor={C.skyMid} /><stop offset="1" stopColor={C.skyHz} />
            </linearGradient>
            <linearGradient id="i-sea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.seaFar} /><stop offset="0.3" stopColor={C.seaBands[1]} /><stop offset="1" stopColor={C.seaNear} />
            </linearGradient>
            <radialGradient id="i-bodyGlow">
              <stop offset="0" stopColor={C.bodyC} stopOpacity={C.body?.sun ? 0.55 : 0.32} />
              <stop offset="0.3" stopColor={C.bodyC} stopOpacity={C.body?.sun ? 0.16 : 0.08} />
              <stop offset="1" stopColor={C.bodyC} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="i-haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.skyHz} stopOpacity="0" /><stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.14" /><stop offset="1" stopColor={C.skyHz} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="i-swell" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.line} stopOpacity="0" /><stop offset="0.5" stopColor={C.line} stopOpacity="1" /><stop offset="1" stopColor={C.line} stopOpacity="0" />
            </linearGradient>
            <filter id="i-soft2" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="1.1" /></filter>
            <radialGradient id="i-streak">
              <stop offset="0" stopColor={C.bodyC} stopOpacity="0.55" /><stop offset="0.35" stopColor={C.bodyC} stopOpacity="0.14" /><stop offset="1" stopColor={C.bodyC} stopOpacity="0" />
            </radialGradient>
            <filter id="i-ghost" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
            <clipPath id="i-skyClip"><rect x="0" y="0" width={W} height={HORIZON} /></clipPath>
            {C.body && !C.body.sun && (
              <mask id="i-phase" maskUnits="userSpaceOnUse">
                <circle cx={C.body.x} cy={C.body.y} r="34" fill="#fff" />
                {C.body.illum < 0.97 && <circle cx={C.body.x + (C.body.waxing ? -1 : 1) * 58 * C.body.illum} cy={C.body.y} r="31" fill="#000" />}
              </mask>
            )}
            <filter id="i-disc" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" /></filter>
            <linearGradient id="i-reflFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="i-reflMask" maskUnits="userSpaceOnUse">
              <rect x="0" y={WATER} width={W} height={MH * 0.9} fill="url(#i-reflFade)" />
            </mask>
            <clipPath id="i-above"><rect x="0" y="0" width={W} height={WATER + 1} /></clipPath>
            <clipPath id="i-below"><rect x="0" y={WATER} width={W} height={H - WATER} /></clipPath>
            <filter id="i-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="i-motion" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={`${motionBlur * 0.15} ${motionBlur}`} /></filter>
            <filter id="i-word" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation={12 * (1 - wordK)} /></filter>
            <filter id="i-tag" x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation={8 * (1 - tagK)} /></filter>
            <filter id="i-cam" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={camBlur / viewScale} /></filter>
          </defs>
          <g filter={gl && camBlur > 0.2 ? 'url(#i-cam)' : undefined}>

          {/* без видеокарты — та же сцена в SVG: небо, светило, море, изобаты, дорожка, острова, буи, блик */}
          {gl === false && (
            <>
            {/* небо: мягкий градиент, звёзды-точки, солнце или луна с мягким ореолом */}
            <rect width={W} height={HORIZON} fill="url(#i-sky)" />
            {C.stars > 0.02 && scene.stars.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#F4F6FB" opacity={(0.25 + 0.55 * (0.5 + 0.5 * Math.sin(T * s.sp * 0.6 + s.ph))) * C.stars} />
            ))}
            {C.body && (
              <g clipPath="url(#i-skyClip)" opacity={Math.min(1, C.body.seen * 1.2)}>
                <circle cx={C.body.x} cy={C.body.y} r={C.body.sun ? 230 : 170} fill="url(#i-bodyGlow)" />
                <g filter="url(#i-disc)">
                  {!C.body.sun && <circle cx={C.body.x} cy={C.body.y} r="29" fill={C.bodyC} opacity="0.07" />}
                  <circle cx={C.body.x} cy={C.body.y} r={C.body.sun ? 34 : 29} fill={C.bodyC} mask={C.body.sun ? undefined : 'url(#i-phase)'} />
                </g>
              </g>
            )}

            {/* море: мягкий градиент, зыбь катится к зрителю, изобаты, переливающаяся дорожка под светилом */}
            <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#i-sea)" />
            {Array.from({ length: 10 }, (_, i) => {
              const p = ((i / 10 + T * 0.03) % 1);
              const k = p ** 1.9;
              const h = 2 + 44 * k;
              return <rect key={`sw${i}`} x="0" y={HORIZON + (H - HORIZON) * k - h / 2} width={W} height={h} fill="url(#i-swell)" opacity={0.06 * Math.sin(Math.PI * p)} />;
            })}
            {Array.from({ length: 13 }, (_, i) => {
              const p = ((i / 13 + T * 0.012) % 1);
              const k = p ** 1.7;
              const y = HORIZON + 10 + (H - HORIZON - 10) * k;
              const A = 2 + 9 * k, L = 140 + 260 * k, ph = T * 0.35 + i * 1.7;
              let d = `M-40,${y + A * Math.sin(ph)}`;
              for (let x = 0; x <= W + 40; x += 40) d += ` L${x},${(y + A * Math.sin((x / L) * Math.PI * 2 + ph)).toFixed(1)}`;
              return <path key={`iso${i}`} d={d} fill="none" stroke={C.line} strokeWidth={0.8 + 1.2 * k} opacity={0.1 * Math.sin(Math.PI * p)} />;
            })}
            {C.body && (
              <g filter="url(#i-soft2)">
                {scene.glints.map((g, i) => {
                  const k = (g.y - HORIZON) / (H - HORIZON);
                  const len = 8 + k * 95 * (0.4 + g.j);
                  const x = C.body!.x + Math.sin(T * 0.7 + g.ph) * (4 + k * 40) - len / 2;
                  return <rect key={`gl${i}`} x={x} y={g.y} width={len} height={1.5 + k * 2.4} rx="1.5" fill={C.bodyC}
                    opacity={(0.15 + 0.6 * (0.5 + 0.5 * Math.sin(T * g.sp + g.ph))) * (1 - k * 0.45) * (C.body!.sun ? 1 : 0.85) * Math.min(1, C.body!.seen * 1.2)} />;
                })}
              </g>
            )}

            {/* горизонт: светлая дымка и острова в лёгкой дымке */}
            <rect y={HORIZON - 40} width={W} height="80" fill="url(#i-haze)" />
            <g filter="url(#i-soft2)">{scene.islands.map((d, i) => <path key={`is${i}`} d={d} fill={C.island} opacity="0.92" />)}</g>
              {/* буи сети вдали с огоньками */}
              {[[0.13, 10.5], [0.31, 7], [0.69, 12.5], [0.875, 6.2]].map(([bx, d], i) => {
                const [x0, x1] = visibleX(innerWidth, innerHeight);
                const k = 10 / d, y = HORIZON + (1 / d - 0.06) * H, x = x0 + bx * (x1 - x0);
                const br = 0.22 + 0.78 * (0.5 + 0.5 * Math.sin(T * 0.7 + i * 2.4)) ** 3;
                return (
                  <g key={`bu${i}`}>
                    <rect x={x - 0.7 * k} y={y - 7.5 * k} width={1.4 * k} height={7.5 * k} fill={C.island} opacity="0.85" />
                    <ellipse cx={x} cy={y} rx={2 * k} ry={1.1 * k} fill={C.island} opacity="0.85" />
                    <circle cx={x} cy={y - 8 * k} r={4 * k} fill="#D2E4BF" opacity={0.25 * br * (0.3 + 0.7 * C.stars)} filter="url(#i-ghost)" />
                    <circle cx={x} cy={y - 8 * k} r={1.1 * k} fill="#D2E4BF" opacity={br * (0.3 + 0.7 * C.stars)} />
                  </g>
                );
              })}
              {/* блик объектива: тонкий луч через светило и призраки по линии к центру кадра */}
              {fb && (
                <g opacity={Math.min(1, fb.seen * 1.2) * (fb.sun ? 1 : 0.5)}>
                  <ellipse cx={fb.x} cy={fb.y} rx="640" ry="5" fill="url(#i-streak)" />
                  {([[0.58, 26, C.bodyC, 0.1], [1.32, 64, '#A9D1B6', 0.06], [1.72, 17, '#B9C4FF', 0.1], [2.15, 110, C.bodyC, 0.035]] as const).map(([k, r, c, o], i) => (
                    <circle key={`gh${i}`} cx={fb.x + (CX - fb.x) * k} cy={fb.y + (450 - fb.y) * k} r={r} fill={c} opacity={o} filter="url(#i-ghost)" />
                  ))}
                </g>
              )}
            </>
          )}

          {/* круги от падения и сигнал буя */}
          {tau > 0 && [0, 0.22, 0.44].map((d, k) => {
            const a = tau - d;
            if (a <= 0) return null;
            const rx = MW * 0.5 + 250 * a;
            return <ellipse key={`r${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.line} strokeWidth="2" opacity={Math.max(0, 0.7 * (1 - a / 2.4))} />;
          })}
          <g filter="url(#i-glow)">
            {[0, 0.45].map((d, k) => {
              const a = t - T_PING - d;
              if (a <= 0 || a > 2.2) return null;
              const rx = MW * 0.45 + 420 * a;
              return <ellipse key={`p${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.accent} strokeWidth="2.5" opacity={Math.max(0, 0.9 * (1 - a / 2.0))} />;
            })}
          </g>

          {/* отражение щита, поплавок со смазом движения */}
          {fallen && tau > -0.05 && (
            <g clipPath="url(#i-below)" mask="url(#i-reflMask)" opacity="0.24">
              <g transform={`translate(${CX} ${WATER}) skewX(${Math.sin(T * 2.2) * 4}) translate(${-CX} ${-WATER}) translate(0 ${2 * WATER}) scale(1 -1)`}>
                {markG}
              </g>
            </g>
          )}
          {fallen && (
            <g filter={motionBlur > 0.3 ? 'url(#i-motion)' : undefined}>
              <g clipPath="url(#i-below)" opacity="0.13">{markG}</g>
              <g clipPath="url(#i-above)">{markG}</g>
            </g>
          )}
          {tau > 0 && (
            <path d={`M${CX - MW * 0.7},${WATER + 3 * Math.sin(T * 1.3)} Q${CX},${WATER + 5} ${CX + MW * 0.7},${WATER + 3 * Math.sin(T * 1.3 + 1)}`}
              fill="none" stroke={C.line} strokeWidth="2" opacity={0.55} />
          )}

          {/* пена, брызги штрихами по траектории, пузыри */}
          {tau > 0 && tau < 0.7 && (
            <ellipse cx={CX} cy={WATER} rx={MW * (0.6 + tau * 1.2)} ry={9 + tau * 6} fill={C.primary} opacity={0.5 * (1 - tau / 0.7)} />
          )}
          {tau > 0 && tau < 1.3 && scene.drops.map((d, i) => {
            const x = CX + d.vx * tau;
            const vy2 = d.vy + 1500 * tau;
            const y = WATER - 12 + d.vy * tau + 0.5 * 1500 * tau * tau;
            if (y > WATER + 2) return null;
            const sp = Math.hypot(d.vx, vy2);
            const ang = (Math.atan2(vy2, d.vx) * 180) / Math.PI;
            return <ellipse key={`d${i}`} cx={x} cy={y} rx={d.r * (1 + sp * 0.006)} ry={d.r * 0.7}
              transform={`rotate(${ang} ${x} ${y})`} fill={C.primary} opacity={Math.max(0, 0.95 - tau / 1.25)} />;
          })}
          {scene.bubbles.map((b, i) => {
            const a = t - b.t;
            if (a < 0 || a > 0.45) return null;
            return <circle key={`b${i}`} cx={CX + b.dx} cy={WATER - 2 - a * 6} r={2 + a * 12} fill="none" stroke={C.primary} strokeWidth="1.2" opacity={0.7 * (1 - a / 0.45)} />;
          })}

          {/* название проявляется из размытия */}
          {t >= T_WORD && (
            <g opacity={wordK} transform={`translate(0 ${(1 - wordK) * 16})`} filter={wordK < 0.99 ? 'url(#i-word)' : undefined}>
              <image href={C.word} x={CX - 190} y={168} width={380} height={380 / 4.09} />
            </g>
          )}
          {t >= T_TAG && (
            <text x={CX} y={318} textAnchor="middle" fill={C.muted} fontFamily="Inter, sans-serif" fontSize="20" fontWeight="600"
              letterSpacing={6 + 8 * (1 - tagK)} opacity={tagK} filter={tagK < 0.99 ? 'url(#i-tag)' : undefined}>
              БРАКОНЬЕР НЕ НАЙДЕН
            </text>
          )}
          </g>
        </svg>
        {/* виньетка — вне сцены: при взгляде вниз сцена поднимается, а края кадра остаются */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(75% 75% at 50% 48%, rgb(0 0 0 / 0) 55%, rgb(0 0 0 / ${C.vignette * (gl ? 0.6 : 1)}) 100%)` }} />

        {/* камыш: средний план чуть мягче, передний — сильно размыт (глубина резкости) */}
        <ReedsImage side="left" seed={11} count={12} color={C.reedMid} blur={reedBlur(1.2, 46)} className="absolute bottom-[-2vh] left-[4vw] h-[46vh] w-auto" style={midBlur} />
        <ReedsImage side="right" seed={23} count={12} color={C.reedMid} blur={reedBlur(1.2, 42)} className="absolute bottom-[-2vh] right-[4vw] h-[42vh] w-auto" style={midBlur} />
        <ReedsImage side="left" seed={5} count={14} color={C.reedNear} blur={reedBlur(7, 82)} className="absolute bottom-[-8vh] left-[-6vw] h-[82vh] w-auto" />
        <ReedsImage side="right" seed={17} count={14} color={C.reedNear} blur={reedBlur(7, 78)} className="absolute bottom-[-8vh] right-[-6vw] h-[78vh] w-auto" />
      </div>

      <div className="absolute right-4 top-4 flex items-center gap-2" style={{ opacity: 1 - outK }}>
        {needsTap && soundOn && (
          <button type="button" className="flex items-center gap-1.5 rounded-chip border border-accent/60 bg-accent/15 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-accent/30">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 8v4h3l4 3.5v-11L6 8H3z" /><path d="M13.5 7a4 4 0 0 1 0 6M15.6 5a7 7 0 0 1 0 10" />
            </svg>
            Включить звук
          </button>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); skip(); }}
          className="rounded-chip border border-line bg-bg/40 px-3 py-1.5 text-[12px] text-muted backdrop-blur hover:text-primary">
          Пропустить
        </button>
      </div>
    </div>
  );
}
