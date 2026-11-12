import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SeaSound } from '../introSound';
import { useSoundOn } from '../sound';
import { ReedsImage } from './Reeds';
import { HZ, currentSky, type Sky } from '../theme';
import { hex, palAt, type V3 } from '../skyPalette';
import { createSea, frameFrom, seaClock, targets, type Frame, type Sea } from '../sea';
import { setIntroCover, setIntroPlaying, whenAppSettled } from '../introBus';

/**
 * Интро: то же море, что на фоне сайта (один рисовальщик, sea.ts), только ракурс ниже и с бликом
 * объектива от солнца или луны. Камера наводит резкость, знак падает, как поплавок: разгоняется,
 * с плеском уходит в воду почти целиком, всплывает и затухающе качается, пока не встанет — в воде
 * низ сердцевины и игла. Под водой его видно сквозь толщу, по воде — отражение, у входа в воду
 * мениск, от каждого качания расходятся круги. Буй подаёт сигнал сонара, из размытия проявляется
 * «404 · Браконьер не найден». В конце взгляд опускается к воде — горизонт встаёт туда, где он
 * на фоне, и сцена растворяется в дашборде.
 * Стартует, когда всё готово (шейдер, картинки, первая отрисовка дашборда) — без рывков в начале.
 * Звук — если браузер разрешит; иначе по первому касанию (кнопка «Включить звук»). Без видеокарты — SVG.
 */

const W = 1600, H = 900, HORIZON = 470, WATER = 610, CX = 800;
const MARK_RATIO = 819.83 / 1250;        // ширина / высота знака (brand/src/mark-data.mjs)
const MH = 210, MW = MH * MARK_RATIO;
const T_IN = 1.1;
const T_PING = 2.8, T_WORD = 3.2, T_TAG = 3.8, T_OUT = 5.8, OUT = 0.9;

// ---------- заброс: поплавок летит удочкой сверху ----------
/**
 * Удилище — над камерой, за верхним краем кадра. Поплавок влетает сверху крупным (он ещё близко),
 * по дуге уходит вдаль и вниз к воде — уменьшается (перспектива). Леска тянет его макушкой назад,
 * к удилищу; к воде он выпрямляется. Дуга подобрана так, что в момент касания скорость совпадает
 * с физикой плавучести ниже.
 */
const T_CAST = 0.3, T_HIT = 1.45, V_HIT = 1500;
const FLIGHT = T_HIT - T_CAST;
const PIV = 0.6;                                   // точка вращения — на 60 % высоты (там ватерлиния в покое)
const LAUNCH = { x: CX - 250, y: -240, s: 2.1 };   // откуда летит: над кадром, чуть левее места падения
const ROD = { x: CX - 430, y: -560 };              // кончик удилища — высоко над кадром
/** На узком экране края кадра обрезаны — бросок и удилище не уходят за видимый левый край */
function fitToView(vw: number, vh: number) {
  const [x0] = visibleX(vw, vh);
  LAUNCH.x = Math.max(CX - 250, x0 + 70);
  ROD.x = Math.max(CX - 430, x0 - 60);
}
const HIT_TOP = WATER - 0.78 * MH;                 // касание — когда в воду входит сердцевина
const HIT_PY = HIT_TOP + PIV * MH;
const G_ARC = (2 * (LAUNCH.y + V_HIT * FLIGHT - HIT_PY)) / FLIGHT ** 2;
const VY0 = V_HIT - G_ARC * FLIGHT;
const REST_TILT = -17;                             // в покое лежит бочком — леска тянет к рыбаку
const HIT_TILT = -9;

// ---------- поплавок в воде: плавучесть ----------
/** Силуэт знака по высоте — 20 полос сверху вниз: сколько воды он вытесняет на этой глубине */
const AREA = [0, 2, 3, 4, 26, 45, 34, 110, 132, 105, 74, 57, 48, 38, 21, 11, 5, 4, 3, 2];
/** Погружённая площадь, если ватерлиния на доле h высоты знака сверху (h < 0 — целиком под водой) */
function submerged(h: number) {
  let s = 0;
  for (let i = 0; i < 20; i++) { const r0 = i / 20; s += AREA[i] * Math.min(1, Math.max(0, (r0 + 0.05 - Math.max(r0, h)) / 0.05)); }
  return s;
}
const EQ = 0.6;                            // в покое ватерлиния на 60 % высоты: в воде низ сердцевины и игла
const DT = 1 / 240;
/**
 * После касания — один расчёт: тяжесть, выталкивающая сила по погружённой части силуэта,
 * сопротивление воды (вязкое и квадратичное) и воздуха. Развороты качания запоминаем:
 * от каждого по воде пойдёт цуг волн.
 */
const PATH = (() => {
  const G = 2600, C1 = 10, C2 = 0.005, AIR = 0.1, TOTAL = submerged(-1), SUB_EQ = submerged(EQ);
  const n = Math.ceil((T_OUT + OUT + 1 - T_HIT) / DT);
  const top = new Float32Array(n), vel = new Float32Array(n);
  let y = HIT_TOP, v = V_HIT;
  const turns: { t: number; amp: number }[] = [];
  let lastTurnH = 0.78;
  for (let i = 0; i < n; i++) {
    top[i] = y; vel[i] = v;
    const t = T_HIT + i * DT, h = (WATER - y) / MH;
    const sub = submerged(h);
    const a = G - (G * sub) / SUB_EQ - (C1 * v + C2 * v * Math.abs(v)) * Math.sqrt(sub / TOTAL) - AIR * v;
    const nv = v + a * DT;
    if (Math.sign(nv) !== Math.sign(v)) { turns.push({ t, amp: Math.abs(h - lastTurnH) }); lastTurnH = h; }
    v = nv; y += v * DT;
  }
  return { top, vel, turns };
})();
const sample = (arr: Float32Array, t: number) => {
  const x = Math.min(arr.length - 1.001, Math.max(0, (t - T_HIT) / DT)), i = Math.floor(x);
  return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
};
const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

interface Pose { x: number; py: number; s: number; tilt: number; vx: number; vy: number }
/** Где поплавок: x и y точки вращения, масштаб (ближе к камере — крупнее), наклон, скорость */
function pose(t: number): Pose {
  if (t < T_HIT) {
    const tau = Math.max(0, t - T_CAST), u = tau / FLIGHT;
    // по горизонтали — замедляется, уходя вдаль; по вертикали — бросок под тяжестью
    const x = LAUNCH.x + (CX - LAUNCH.x) * (u + 0.45 * u * (1 - u));
    const vx = ((CX - LAUNCH.x) * (1 + 0.45 * (1 - 2 * u))) / FLIGHT;
    const py = LAUNCH.y + VY0 * tau + 0.5 * G_ARC * tau * tau;
    const sc = 1 + (LAUNCH.s - 1) * (1 - u) ** 1.3;
    // в полёте леска тянет макушку к удилищу, поплавок чуть кувыркается; к воде выпрямляется
    const aim = (Math.atan2(ROD.x - x, py - ROD.y) * 180) / Math.PI;
    const tilt = aim + (HIT_TILT - aim) * smooth(u) + 7 * Math.sin(u * Math.PI * 2.5) * (1 - u);
    return { x, py, s: sc, tilt, vx, vy: VY0 + G_ARC * tau };
  }
  const tau = t - T_HIT;
  const wave = 2.5 * Math.sin(1.6 * t) * (1 - Math.exp(-tau * 0.7));
  const top = sample(PATH.top, t) + wave;
  // качается вокруг наклона покоя: от удара — затухающе, потом едва заметно на волне
  const tilt = REST_TILT + (HIT_TILT - REST_TILT) * Math.exp(-2.4 * tau)
    + 6 * Math.exp(-1.3 * tau) * Math.sin(5.5 * tau) + 1.1 * Math.sin(1.3 * t) * (1 - Math.exp(-tau));
  return { x: CX, py: top + PIV * MH, s: 1, tilt, vx: 0, vy: sample(PATH.vel, t) };
}
const topOf = (p: Pose) => p.py - PIV * MH * p.s;

/**
 * Волны от поплавка для шейдера (в единицах плоскости воды): от удара и от каждого разворота качания
 * расходится цуг из нескольких гребней — он расплывается и слабеет с расстоянием, как на настоящей воде.
 * Сигнал сонара — два кольца цветом акцента. Берём шесть самых заметных.
 * Формат: радиус середины цуга, сила, ширина огибающей, вид (0 — вода, 1 — сонар).
 */
function ringsAt(t: number) {
  const all: number[][] = [];
  const add = (t0: number, speed: number, amp: number, width: number, kind: number, r0 = 0.1, life = 4) => {
    const age = t - t0;
    if (age <= 0 || age > life) return;
    const r = r0 + speed * age;
    const k = amp * Math.exp(-age * (kind ? 1.1 : 0.7)) * Math.min(1, age * 6) / Math.sqrt(1 + r / 0.35);
    if (k > 0.01) all.push([r, k, width * (1 + age * 0.9), kind]);
  };
  add(T_HIT, 0.62, 1, 0.075, 0);
  add(T_HIT + 0.2, 0.5, 0.55, 0.06, 0);
  PATH.turns.slice(0, 5).forEach((e) => add(e.t, 0.45, Math.min(0.6, e.amp * 1.4), 0.05, 0));
  [0, 0.45].forEach((d) => add(T_PING + d, 1.7, 0.9, 0.035, 1, 0.1, 2.2));
  all.sort((a, b) => b[1] - a[1]);
  const out = new Float32Array(24);
  for (let i = 0; i < 6; i++) { const r = all[i]; if (r) out.set(r, i * 4); else out.set([0, 0, 1, 0], i * 4); }
  return out;
}

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


/** Затухание ripples-полей знака: альфа-маска для поиска мест, где тело входит в воду */
interface MarkMask { w: number; h: number; alpha: Uint8ClampedArray }
/** Где тело знака пересекает воду: до четырёх отрезков в долях ширины знака (0…1) */
function contactsAt(m: MarkMask, row: number) {
  const out: number[][] = [];
  if (row < 0 || row >= 1) return out;
  const y = Math.floor(row * m.h);
  let x0 = -1;
  for (let x = 0; x <= m.w; x++) {
    const on = x < m.w && m.alpha[(y * m.w + x) * 4 + 3] > 90;
    if (on && x0 < 0) x0 = x;
    if (!on && x0 >= 0) { out.push([x0 / m.w, x / m.w]); x0 = -1; }
  }
  return out.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 4);
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
    // брызги: корона у места удара — вверх и в стороны, крупные капли ниже, мелкие выше
    const drops = Array.from({ length: 30 }, () => {
      const a = (35 + r() * 110) * (Math.PI / 180), sp = 260 + r() * 520;
      return { x0: (r() - 0.5) * MW * 0.7, vx: Math.cos(a) * sp * 0.7 + 50, vy: -Math.sin(a) * sp, r: 1.2 + r() * 2.6 };
    });
    const bubbles = Array.from({ length: 9 }, (_, i) => ({ t: T_HIT + 0.15 + i * 0.14 + r() * 0.12, dx: (r() - 0.5) * MW * 0.9, f: 600 + r() * 500 }));
    const shore = (x0: number, x1: number) => {
      let d = `M${x0},${HORIZON + 2}`;
      for (let x = x0; x <= x1; x += 18) d += ` L${x},${HORIZON - 3 - r() * 9 - (r() < 0.12 ? 7 : 0)}`;
      return d + ` L${x1},${HORIZON + 2} Z`;
    };
    const islands = [shore(-20, 560), shore(1060, 1300), shore(1380, 1620)];
    return { stars, glints, drops, bubbles, islands };
  }, []);
}

export default function Intro({ onDone, moon = 0.3 }: { onDone: () => void; moon?: number }) {
  const scene = useScene();
  const soundOn = useSoundOn();
  const [C] = useState(() => buildPalette(currentSky(), moon));   // небо на момент показа
  const moonRef = useRef(moon);
  moonRef.current = moon;
  const rootRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const sea = useRef<{ gfx: Sea; f: Frame; mask: MarkMask | null; tg: ReturnType<typeof targets> } | null>(null);
  const [gl, setGl] = useState<boolean | null>(null);
  const [t, setT] = useState(0);
  const [started, setStarted] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const born = useRef(0);
  const sound = useRef<SeaSound | null>(null);
  const scheduled = useRef(false);
  const done = useRef(false);

  const freeze = useRef(frozenAt());
  const now = () => freeze.current ?? (born.current ? (performance.now() - born.current) / 1000 : 0);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    sound.current?.fadeOut(0.6);
    window.setTimeout(onDone, 50);
  }, [onDone]);

  const skip = () => {
    // «Пропустить» — сразу к растворению сцены
    if (!born.current) { born.current = performance.now(); setStarted(true); }
    if (now() < T_OUT) born.current = performance.now() - T_OUT * 1000;
  };

  // море — тем же рисовальщиком, что фон сайта; сам фон, гидрофон и обновления под заставкой ждут
  useLayoutEffect(() => {
    setIntroCover(true);
    setIntroPlaying(true);
    fitToView(innerWidth, innerHeight);               // и для запасной сцены без видеокарты
    let gfx: Sea | null = null;
    try { gfx = cvRef.current ? createSea(cvRef.current, new URLSearchParams(location.search).has('sea'), { scale: 0.45, intro: true }) : null; } catch { gfx = null; }
    setGl(!!gfx);
    if (!gfx) return () => { setIntroCover(false); setIntroPlaying(false); };
    const g = gfx;
    // небо за семь секунд заставки не меняется — светила и палитру считаем один раз
    const tg = targets('calm', moonRef.current);
    const st = { gfx: g, f: { ...frameFrom(tg, HZ), gain: 1 }, mask: null as MarkMask | null, tg };
    sea.current = st;
    // знак — текстурой для отражения и подводной части; его альфа — чтобы найти, где тело входит в воду
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.height = 512; c.width = Math.round(512 * MARK_RATIO);
      const g2 = c.getContext('2d', { willReadFrequently: true });
      if (!g2) return;
      g2.drawImage(img, 0, 0, c.width, c.height);
      st.mask = { w: c.width, h: c.height, alpha: g2.getImageData(0, 0, c.width, c.height).data };
      g.setMark(c);
    };
    img.src = C.mark;
    const resize = () => { fitToView(innerWidth, innerHeight); g.resize(innerWidth, innerHeight); };
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); g.dispose(); sea.current = null; setIntroCover(false); setIntroPlaying(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Кадр моря: ракурс интро; в конце взгляд опускается к воде — горизонт и светила встают как на фоне */
  const drawSea = (tt: number) => {
    const st = sea.current;
    if (!st) return;
    const f = st.f;
    const v = viewMap(innerWidth, innerHeight);
    const k = ease((tt - T_OUT) / OUT);
    f.hz = v.hz + (HZ - v.hz) * k;
    const shift = f.hz - v.hz;
    const tg = st.tg;
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
    f.pulse = [0, 0, 0, 0];
    // поплавок в воде: опора на ватерлинии, верх и высота знака, наклон; где тело входит в воду
    const asp = innerWidth / innerHeight;
    const P = pose(tt), top = topOf(P), tilt = (P.tilt * Math.PI) / 180;
    const [px] = v.toUv(P.x, WATER);
    const [ix, wl] = v.toUv(CX, WATER);
    const hUv = (v.toUv(0, 0)[1] - v.toUv(0, MH)[1]) * P.s;
    const inWater = tt >= T_HIT;
    // отражение в воде проявляется, когда поплавок подлетает к ней
    const near = inWater ? 1 : smooth((top + MH * P.s - (WATER - 240)) / 240);
    const cont = new Float32Array(8);
    if (st.mask && inWater) {
      const segs = contactsAt(st.mask, (WATER - top) / MH);
      const wA = hUv * MARK_RATIO * Math.cos(tilt);
      segs.forEach((sg, i) => cont.set([px * asp + (sg[0] - 0.5) * wA, px * asp + (sg[1] - 0.5) * wA], i * 2));
    }
    f.intro = {
      mark: [px * asp, wl + shift, v.toUv(0, top)[1] + shift, hUv],
      mark2: [Math.cos(tilt), Math.sin(tilt), MARK_RATIO, st.mask && tt >= T_CAST ? near : 0],
      rings: ringsAt(tt), accent: hex(C.accent), imp: [ix, wl + shift], cont,
      foam: tt > T_HIT ? Math.max(0, 1 - (tt - T_HIT) / 0.9) : 0,
    };
    f.t = freeze.current ?? seaClock();
    const blur = 16 * (1 - easeOut(tt / T_IN));               // наводка резкости; в конце море резкое, как фон под ним
    st.gfx.setFocus(Math.max(0.12, 1 / (1 + blur * 0.35)));
    st.gfx.draw(f);
  };

  // старт — когда готово всё: шейдер, знак, картинки камыша и первая отрисовка дашборда (не дольше 2,5 с)
  useEffect(() => {
    let raf = 0, settled = false, quiet = 0;
    const t0 = performance.now();
    const off = whenAppSettled(() => { settled = true; });
    const imgs = Array.from(rootRef.current?.querySelectorAll('img') ?? []);
    let decoded = false;
    void Promise.all(imgs.map((im) => im.decode().catch(() => undefined))).then(() => { decoded = true; });
    let prevAt = 0;
    const wait = (nowMs: number) => {
      if (born.current) return;
      const st = sea.current;
      const shader = gl === false || (st != null && st.gfx.status() !== 'pending' && st.mask != null);
      if (st && st.gfx.status() === 'fail') setGl(false);
      const timeout = nowMs - t0 > 2500;
      // ещё пара спокойных кадров подряд — значит, страница под заставкой отрисовалась
      quiet = prevAt && nowMs - prevAt < 24 ? quiet + 1 : 0;
      prevAt = nowMs;
      if ((shader && decoded && settled && quiet >= 3) || timeout) {
        born.current = performance.now();
        setStarted(true);
        return;
      }
      raf = requestAnimationFrame(wait);
    };
    if (freeze.current != null) { born.current = performance.now(); setStarted(true); } else raf = requestAnimationFrame(wait);
    return () => { cancelAnimationFrame(raf); off(); };
  }, [gl]);

  // анимация
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    const loop = () => {
      const tt = now();
      setT(tt);
      drawSea(tt);
      if (tt >= T_OUT) setIntroCover(false);      // сцена растворяется — под ней уже живой фон
      if (tt >= T_OUT + OUT && freeze.current == null) finish();
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [finish, started]); // eslint-disable-line react-hooks/exhaustive-deps

  // звук: пробуем сразу; если браузер не разрешил — по первому касанию, с текущего момента сцены
  useEffect(() => {
    if (!soundOn || !started || freeze.current != null) return;
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
      if (at < T_HIT) ev(T_CAST + 0.05, (w) => s.whoosh(w, Math.max(0.1, T_HIT - Math.max(at, T_CAST + 0.05))));
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
  }, [soundOn, started]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- кадр ----------
  const T = t;                                   // время сцены
  const fallen = t >= T_CAST;
  const tau = t - T_HIT;
  const P = pose(t);

  // камера: наводка резкости в начале, растворение в конце
  const inK = easeOut(t / T_IN), outK = ease((t - T_OUT) / OUT);
  const camBlur = 16 * (1 - inK) + 14 * outK;
  const camScale = 1.04 - 0.04 * inK + 0.05 * outK;
  const camOpacity = inK * (1 - outK);
  const vw = innerWidth, vh = innerHeight;
  const viewScale = Math.max(vw / W, vh / H);
  // средний план камыша: резкая и заранее размытая картинки сменяют друг друга прозрачностью —
  // размытие посчитано один раз, а не каждый кадр
  const midSoft = clamp01(camBlur / 3), midSharp = clamp01(1 - camBlur / 12);

  const markAt = (dx = 0, dy = 0) => (
    <g transform={`translate(${P.x + dx} ${P.py + dy}) rotate(${P.tilt}) scale(${P.s}) translate(${-MW / 2} ${-PIV * MH})`}>
      <image href={C.mark} width={MW} height={MH} />
    </g>
  );
  const markG = markAt();
  // смаз полёта без фильтра: пара бледных копий назад по траектории
  const speed = Math.hypot(P.vx, P.vy);
  const trail = fallen && tau < 0 && speed > 900 ? [1, 2, 3].map((i) => (
    <g key={`tr${i}`} opacity={0.2 / i}>{markAt(-P.vx * 0.008 * i, -P.vy * 0.008 * i)}</g>
  )) : null;
  // леска: от кончика удилища за кадром к макушке поплавка; в полёте почти натянута,
  // после касания провисает и ближней частью ложится на воду
  const th = (P.tilt * Math.PI) / 180, arm = PIV * MH * P.s;
  const tip = { x: P.x + Math.sin(th) * arm, y: P.py - Math.cos(th) * arm };
  const slack = tau > 0 ? smooth(tau / 0.9) : 0;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const c1 = { x: lerp(ROD.x, tip.x, 0.33), y: lerp(ROD.y, tip.y, 0.33) + 30 + slack * 120 };
  const c2y = lerp(ROD.y, tip.y, 0.72) + 18;
  const c2 = { x: lerp(ROD.x, tip.x, 0.72), y: c2y + slack * (WATER + 6 - c2y) };
  const lineD = `M${ROD.x},${ROD.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${tip.x},${tip.y}`;
  const wordK = ease((t - T_WORD) / 1.0), tagK = ease((t - T_TAG) / 0.9);
  // взгляд вниз в конце: всё, что стоит на воде, поднимается вместе с горизонтом
  const lift = gl ? (HZ - viewMap(vw, vh).hz) * outK * vh : 0;
  // надписи — обычным HTML поверх сцены в тех же координатах кадра: проявление из размытия
  // делает видеокарта на готовой картинке, сцену под ними не перерисовываем
  const stage = { transform: `translate(${(vw - W * viewScale) / 2}px, ${(vh - H * viewScale) / 2 - lift}px) scale(${viewScale})` };
  const tagLs = 6 + 8 * (1 - tagK);
  const fb = C.body && C.body.y < HORIZON - 8 ? C.body : null;     // светило над горизонтом — есть блик

  return (
    <div ref={rootRef} role="dialog" aria-label="Заставка 404" className="fixed inset-0 z-[3000] overflow-hidden">
      <div className="absolute inset-0" style={{ background: `rgb(${C.fade})`, opacity: 1 - outK, willChange: 'opacity' }} />
      {/* камера: масштаб и прозрачность — на видеокарте; расфокус моря — сцена рисуется мельче и растягивается.
          Никаких размытий всего экрана и SVG-фильтров по сцене: они пересчитывались каждый кадр и давали лаги */}
      <div className="absolute inset-0" style={{ transform: `scale(${camScale})`, opacity: camOpacity, willChange: 'transform, opacity' }}>
        <canvas ref={cvRef} className="absolute inset-0 h-full w-full" style={{ display: gl === false ? 'none' : undefined }} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden
          style={{ transform: lift ? `translateY(${-lift}px)` : undefined, willChange: 'transform' }}>
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
            {/* над водой знак виден целиком, к ватерлинии край мягко гаснет (дальше — мениск и вода из шейдера) */}
            <linearGradient id="i-wl" gradientUnits="userSpaceOnUse" x1="0" y1={WATER - 2.5} x2="0" y2={WATER + 0.5}>
              <stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="i-aboveM" maskUnits="userSpaceOnUse">
              <rect x="0" y="0" width={W} height={WATER - 2.5} fill="#fff" />
              <rect x="0" y={WATER - 2.5} width={W} height="3" fill="url(#i-wl)" />
            </mask>
          </defs>

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

          {/* без видеокарты: круги, сонар, отражение и подводная часть — в SVG (с видеокартой это делает шейдер) */}
          {gl === false && (
            <>
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
              {fallen && tau > -0.05 && (
                <g clipPath="url(#i-below)" mask="url(#i-reflMask)" opacity="0.24">
                  <g transform={`translate(${CX} ${WATER}) skewX(${Math.sin(T * 2.2) * 4}) translate(${-CX} ${-WATER}) translate(0 ${2 * WATER}) scale(1 -1)`}>
                    {markG}
                  </g>
                </g>
              )}
              {fallen && <g clipPath="url(#i-below)" opacity="0.13">{markG}</g>}
              {tau > 0 && tau < 0.7 && (
                <ellipse cx={CX} cy={WATER} rx={MW * (0.6 + tau * 1.2)} ry={9 + tau * 6} fill={C.primary} opacity={0.5 * (1 - tau / 0.7)} />
              )}
            </>
          )}

          {/* леска и поплавок: над водой — чётко, ниже ватерлинии его рисует вода */}
          {fallen && (
            <path d={lineD} fill="none" stroke={C.light ? '#2B3442' : '#E8EDF3'} strokeWidth={1.1} strokeLinecap="round"
              opacity={0.42 - 0.12 * slack} />
          )}
          {fallen && <g mask="url(#i-aboveM)">{trail}{markG}</g>}

          {/* брызги: корона от удара летит по дуге и падает обратно, капли вытянуты по скорости; пузыри */}
          {tau > 0 && tau < 1.4 && scene.drops.map((d, i) => {
            const g = 1500;
            const x = CX + d.x0 + d.vx * tau;
            const vy2 = d.vy + g * tau;
            const y = WATER - 4 + d.vy * tau + 0.5 * g * tau * tau;
            if (y > WATER + 1) return null;
            const sp = Math.hypot(d.vx, vy2);
            const ang = (Math.atan2(vy2, d.vx) * 180) / Math.PI;
            return <ellipse key={`d${i}`} cx={x} cy={y} rx={d.r * (1 + sp * 0.005)} ry={d.r * 0.7}
              transform={`rotate(${ang} ${x} ${y})`} fill={C.primary} opacity={Math.max(0, 0.9 - tau / 1.4)} />;
          })}
          {scene.bubbles.map((b, i) => {
            const a = t - b.t;
            if (a < 0 || a > 0.45) return null;
            return <circle key={`b${i}`} cx={CX + b.dx} cy={WATER - 2 - a * 6} r={2 + a * 12} fill="none" stroke={C.primary} strokeWidth="1.2" opacity={0.7 * (1 - a / 0.45)} />;
          })}
        </svg>
        {/* название проявляется из размытия */}
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, ...stage }} aria-hidden>
          <img src={C.word} alt="" draggable={false} className="absolute"
            style={{ left: CX - 190, top: 168, width: 380, height: 380 / 4.09, opacity: wordK, willChange: 'transform, opacity, filter',
              transform: `translateY(${(1 - wordK) * 16}px)`, filter: wordK > 0 && wordK < 0.99 ? `blur(${12 * (1 - wordK)}px)` : undefined }} />
          <div className="absolute left-0 whitespace-nowrap text-center font-semibold"
            style={{ top: 301, width: W, fontSize: 20, lineHeight: '20px', color: C.muted, letterSpacing: tagLs, paddingLeft: tagLs, opacity: tagK,
              willChange: 'opacity, filter', filter: tagK > 0 && tagK < 0.99 ? `blur(${8 * (1 - tagK)}px)` : undefined }}>
            БРАКОНЬЕР НЕ НАЙДЕН
          </div>
        </div>
        {/* виньетка — вне сцены: при взгляде вниз сцена поднимается, а края кадра остаются */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(75% 75% at 50% 48%, rgb(0 0 0 / 0) 55%, rgb(0 0 0 / ${C.vignette * (gl ? 0.6 : 1)}) 100%)` }} />

        {/* камыш: средний план чуть мягче, передний — сильно размыт (глубина резкости) */}
        {/* все картинки на месте с первого кадра (декодированы до старта), лишние — прозрачны */}
        {gl !== false && (
          <>
            <ReedsImage side="left" seed={11} count={12} color={C.reedMid} blur={reedBlur(10, 46)} className="absolute bottom-[-2vh] left-[4vw] h-[46vh] w-auto" style={{ opacity: midSoft }} />
            <ReedsImage side="right" seed={23} count={12} color={C.reedMid} blur={reedBlur(10, 42)} className="absolute bottom-[-2vh] right-[4vw] h-[42vh] w-auto" style={{ opacity: midSoft }} />
          </>
        )}
        <ReedsImage side="left" seed={11} count={12} color={C.reedMid} blur={reedBlur(1.2, 46)} className="absolute bottom-[-2vh] left-[4vw] h-[46vh] w-auto" style={{ opacity: gl === false ? 1 : midSharp }} />
        <ReedsImage side="right" seed={23} count={12} color={C.reedMid} blur={reedBlur(1.2, 42)} className="absolute bottom-[-2vh] right-[4vw] h-[42vh] w-auto" style={{ opacity: gl === false ? 1 : midSharp }} />
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
          className="rounded-chip border border-line bg-bg/60 px-3 py-1.5 text-[12px] text-muted hover:text-primary">
          Пропустить
        </button>
      </div>
    </div>
  );
}
