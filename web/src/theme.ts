/**
 * Тема интерфейса: «Ночь», «День» или «Авто».
 *
 * «Авто» — по настоящему небу над дельтой Волги (район дежурства), время — МСК:
 * солнце и луна стоят там, где они сейчас на самом деле (высота и азимут), а тема
 * меняется постепенно: ночь → тёплые сумерки → день → тёплый закат → ночь.
 * Интерфейс плавно светлеет и теплеет; середину между тёмным и светлым он проходит
 * короткой анимацией — там текст был бы серым на сером и не читался.
 */
import { design } from './design';
import { useEffect, useState } from 'react';

export type ThemePref = 'night' | 'day' | 'auto';
export type Theme = 'night' | 'day';

const KEY = '404-theme';
const SITE = { lat: 45.73, lon: 48.0 };          // дельта Волги, центр района дежурства
const MSK = 'Europe/Moscow';
const RAD = Math.PI / 180;

// ---------- солнце и луна: положение на небе (упрощённые формулы, точность — доли градуса) ----------
const toDays = (d: Date) => d.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
const OBL = RAD * 23.4397;
const ra = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
const dec = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));
const sidereal = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

function horizontal(d: number, raV: number, decV: number) {
  const lw = RAD * -SITE.lon, phi = RAD * SITE.lat;
  const H = sidereal(d, lw) - raV;
  const alt = Math.asin(Math.sin(phi) * Math.sin(decV) + Math.cos(phi) * Math.cos(decV) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decV) * Math.cos(phi)); // от юга, запад +
  const ha = ((((H / RAD) % 360) + 540) % 360) - 180;           // часовой угол: 0 — на юге, растёт равномерно со временем
  return { alt: alt / RAD, az: az / RAD, ha };
}
function sunEcl(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}
export function sunPosition(at: Date = new Date()) {
  const d = toDays(at), L = sunEcl(d);
  return horizontal(d, ra(L, 0), dec(L, 0));
}
export function moonPosition(at: Date = new Date()) {
  const d = toDays(at);
  const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F);
  const pos = horizontal(d, ra(l, b), dec(l, b));
  // фаза: угол между солнцем и луной по долготе; растущая — луна восточнее солнца
  const elong = ((l - sunEcl(d)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return { ...pos, illum: (1 - Math.cos(elong)) / 2, waxing: elong < Math.PI };
}

/** Восход и закат (−0,833° с рефракцией) на календарную дату по МСК. Алгоритм NOAA. */
export function sunTimes(at: Date = new Date(), lat = SITE.lat, lon = SITE.lon) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).split('-').map(Number);
  const day0 = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const n = Math.round((day0 - Date.UTC(parts[0], 0, 0)) / 864e5);
  const g = ((2 * Math.PI) / 365) * (n - 1 + 0.5);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  const h = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD;
  return { rise: new Date(day0 + (720 - 4 * (lon + h) - eq) * 60000), set: new Date(day0 + (720 - 4 * (lon - h) - eq) * 60000) };
}
export const isDaylight = (at: Date = new Date()) => sunPosition(at).alt > -0.833;
export const fmtMsk = (d: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit' }).format(d);

// ---------- небо: что видит фон ----------
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Body { x: number; y: number; visible: number; alt: number }
export interface Sky {
  pref: ThemePref;
  sunAlt: number;     // высота солнца, градусы (для «Ночь»/«День» — условная)
  day: number;        // сколько дня в небе, 0–1 — непрерывно
  warm: number;       // тёплый свет рассвета и заката, 0–1
  ui: number;         // светлота интерфейса, 0–1 (середину проходит анимацией)
  sun: Body;
  moon: Body & { illum: number; waxing: boolean };
}

export const HZ = 0.8;                            // горизонт фона: доля высоты снизу
/**
 * Положение светила → точка на небе фона. Море смотрит на юг: восток слева, запад справа.
 * По горизонтали — часовой угол (растёт равномерно со временем: светило идёт по небу с ровной
 * скоростью, верхняя точка — на юге), по высоте — настоящая высота с плавным приближением к верху
 * кадра. Получается ровная симметричная дуга; ниже нуля светило уходит за горизонт.
 */
export const toScreen = (alt: number, ha: number) => ({
  x: 0.5 + 0.44 * Math.tanh(ha / 75),
  y: HZ + 0.13 * (1 - Math.exp(-Math.max(alt, -12) / 22)),
});

/** Положение светил на момент `at` — для фона каждый кадр (дёшево: десяток тригонометрий) */
export function skyBodies(at: Date) {
  const s = sunPosition(at), m = moonPosition(at);
  const day = smooth(-10, 8, s.alt);
  return {
    sunAlt: s.alt, day,
    sun: { ...toScreen(s.alt, s.ha), alt: s.alt, visible: smooth(-4, 0.5, s.alt) },
    moon: { ...toScreen(m.alt, m.ha), alt: m.alt, visible: smooth(-3, 0.5, m.alt) * (1 - 0.6 * day), illum: m.illum, waxing: m.waxing },
  };
}

// ---------- палитры интерфейса: читаются из CSS (единый источник — brand/tokens и index.css) ----------
const COLOR_VARS = ['--c-bg', '--c-surface', '--c-primary', '--c-grey', '--c-accent', '--c-ok', '--c-warn', '--c-alert', '--c-text-2', '--c-line',
  '--c-card', '--c-spot', '--c-shadow', '--c-vignette', '--c-land', '--c-bar', '--c-bar-strong', '--c-sea-1', '--c-sea-2', '--c-sea-3', '--c-reed', '--c-mist'];
const NUM_VARS = ['--reed-opacity'];
const RGB_FROM: Record<string, string> = { '--rgb-bg': '--c-bg', '--rgb-surface': '--c-surface', '--rgb-primary': '--c-primary', '--rgb-grey': '--c-grey',
  '--rgb-accent': '--c-accent', '--rgb-warn': '--c-warn', '--rgb-alert': '--c-alert' };
type RGBA = [number, number, number, number];
let NIGHT: Record<string, RGBA> = {}, DAY: Record<string, RGBA> = {};
let NIGHT_N: Record<string, number> = {}, DAY_N: Record<string, number> = {};
const WARM_DARK: RGBA = [52, 34, 52, 1];          // сумеречный сливово-янтарный
const WARM_LIGHT: RGBA = [246, 228, 206, 1];      // тёплый песочный

function parseColor(v: string): RGBA {
  v = v.trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const m = v.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return [0, 0, 0, 1];
}
function readPalettes() {
  const el = document.documentElement;
  const prev = el.dataset.theme;
  [...COLOR_VARS, ...NUM_VARS, ...Object.keys(RGB_FROM), '--rgb-veil'].forEach((v) => el.style.removeProperty(v));
  const read = (t: Theme) => {
    el.dataset.theme = t;
    const cs = getComputedStyle(el);
    const col: Record<string, RGBA> = {}, num: Record<string, number> = {};
    COLOR_VARS.forEach((v) => { col[v] = parseColor(cs.getPropertyValue(v)); });
    NUM_VARS.forEach((v) => { num[v] = parseFloat(cs.getPropertyValue(v)) || 0; });
    return [col, num] as const;
  };
  [NIGHT, NIGHT_N] = read('night');
  [DAY, DAY_N] = read('day');
  if (prev) el.dataset.theme = prev; else delete el.dataset.theme;
}

const mixC = (a: RGBA, b: RGBA, k: number): RGBA => [0, 1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * k) as RGBA;
const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const css = (c: RGBA) => (c[3] >= 0.999 ? `rgb(${c.map(Math.round).slice(0, 3).join(' ')})` : `rgb(${c.slice(0, 3).map(Math.round).join(' ')} / ${c[3].toFixed(3)})`);

const WARM_KEYS = new Set(['--c-bg', '--c-surface', '--c-card', '--c-land', '--c-sea-1', '--c-sea-2', '--c-sea-3']);
function palette(k: number, warm: number) {
  const out: Record<string, RGBA> = {};
  for (const v of COLOR_VARS) {
    let c = mixC(NIGHT[v], DAY[v], k);
    if (WARM_KEYS.has(v) && warm > 0) {
      const w = mixC(WARM_DARK, WARM_LIGHT, k);
      c = mixC(c, [w[0], w[1], w[2], c[3]], warm * 0.3);
    }
    out[v] = c;
  }
  return out;
}
/** Хватает ли контраста мелкому тексту на фоне и на карточках */
function readable(k: number, warm: number) {
  const p = palette(k, warm);
  const surf = p['--c-surface'];
  return Math.min(contrast(p['--c-text-2'], p['--c-bg']), contrast(p['--c-text-2'], surf), contrast(p['--c-primary'], p['--c-bg'])) >= 4.5;
}
/** Светлота интерфейса без «серого на сером»: недопустимую середину проскакиваем к ближайшему краю */
function safeUi(k: number, warm: number) {
  if (readable(k, warm)) return k;
  for (let d = 0.01; d <= 1; d += 0.01) {
    const lo = k - d, hi = k + d;
    const pick = k < 0.5 ? [lo, hi] : [hi, lo];
    for (const c of pick) if (c >= 0 && c <= 1 && readable(c, warm)) return c;
  }
  return k < 0.5 ? 0 : 1;
}

// ---------- состояние ----------
/** В оформлении «УПК» тем две — тёмная (морская) и светлая; «Авто» — только в прежнем оформлении и при ?sky / ?speed */
const TWO_THEMES = design !== 'classic';
const readPref = (): ThemePref => {
  const fallback: ThemePref = TWO_THEMES ? 'night' : 'auto';
  try {
    const v = localStorage.getItem(KEY);
    if (TWO_THEMES && v === 'auto') return 'night';
    return v === 'night' || v === 'day' || v === 'auto' ? v : fallback;
  } catch {
    return fallback;
  }
};
/** ?sky=2026-11-12T16:10 — «Авто» как в это время по МСК (проверка и показ рассвета/заката на защите) */
const clockAt = (() => {
  try {
    const q = new URLSearchParams(location.search).get('sky');
    const d = q ? new Date(`${q.length <= 16 ? `${q}:00` : q}+03:00`) : null;
    return d && !Number.isNaN(d.valueOf()) ? d : null;
  } catch {
    return null;
  }
})();
/** ?speed=3600 — небо «Авто» идёт быстрее (3600 — час в секунду) */
const speedAt = (() => {
  try {
    const v = Number(new URLSearchParams(location.search).get('speed'));
    return Number.isFinite(v) && v > 1 ? Math.min(v, 86400) : 1;
  } catch {
    return 1;
  }
})();
/**
 * Часы неба: настоящее время или перемотка (проверить «Авто» за минуту: рассвет, день, закат, ночь).
 * virt — время неба в момент real, дальше оно идёт со скоростью speed.
 */
let clk = { real: Date.now(), virt: (clockAt ?? new Date()).valueOf(), speed: speedAt };
/** Текущее время неба: настоящее, при ?sky или перемотке — выбранный момент, идущий в своём темпе */
export const liveAt = () => new Date(clk.virt + (Date.now() - clk.real) * clk.speed);
export const skySpeed = () => clk.speed;
/** Небо показывает настоящее время (без перемотки) */
export const skyIsLive = () => clk.speed === 1 && Math.abs(liveAt().valueOf() - Date.now()) < 90_000;
let pref: ThemePref = clockAt || speedAt > 1 ? 'auto' : readPref();
let sky: Sky = computeSky(pref);
let theme: Theme = sky.ui >= 0.5 ? 'day' : 'night';
const listeners = new Set<() => void>();
const clockListeners = new Set<() => void>();

function computeSky(p: ThemePref, at: Date = liveAt()): Sky {
  if (p !== 'auto') {
    const isDay = p === 'day';
    return {
      pref: p, sunAlt: isDay ? 40 : -30, day: isDay ? 1 : 0, warm: 0, ui: isDay ? 1 : 0,
      sun: { x: 0.84, y: 0.9, visible: isDay ? 1 : 0, alt: isDay ? 40 : -30 },
      moon: { x: 0.84, y: 0.885, visible: isDay ? 0 : 1, alt: isDay ? -30 : 30, illum: -1, waxing: true },
    };
  }
  const b = skyBodies(at);
  const warm = Math.exp(-(((b.sunAlt - 2) / 8) ** 2));               // тепло у горизонта: рассвет и закат
  const raw = smooth(-6, 10, b.sunAlt);
  return { pref: p, ...b, warm, ui: Object.keys(NIGHT).length ? safeUi(raw, warm) : raw };
}

/** Ставим только изменившиеся переменные: иначе каждая минута «Авто» пересчитывала стили всей страницы */
const lastVars = new Map<string, string>();
function setVar(el: HTMLElement, name: string, value: string) {
  if (lastVars.get(name) === value) return;
  lastVars.set(name, value);
  el.style.setProperty(name, value);
}

function apply(animate: boolean) {
  const el = document.documentElement;
  if (animate) {
    el.classList.add('theme-anim');
    window.setTimeout(() => el.classList.remove('theme-anim'), 900);
  }
  theme = sky.ui >= 0.5 ? 'day' : 'night';
  el.dataset.theme = theme;
  if (Object.keys(NIGHT).length) {
    const p = palette(sky.ui, sky.warm);
    for (const v of COLOR_VARS) setVar(el, v, css(p[v]));
    for (const v of NUM_VARS) setVar(el, v, (NIGHT_N[v] + (DAY_N[v] - NIGHT_N[v]) * sky.ui).toFixed(3));
    for (const [r, c] of Object.entries(RGB_FROM)) setVar(el, r, p[c].slice(0, 3).map(Math.round).join(' '));
    const veil = mixC([255, 255, 255, 1], [11, 22, 40, 1], sky.ui);
    setVar(el, '--rgb-veil', veil.slice(0, 3).map(Math.round).join(' '));
    setVar(el, '--theme-warm', sky.warm.toFixed(2));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', css(p['--c-bg']));
  }
  el.style.colorScheme = theme === 'day' ? 'light' : 'dark';
}

/**
 * Пересчёт неба и темы. При перемотке зовётся 10 раз в секунду: цвета идут без анимации переходов
 * (иначе переходы на всех элементах шли бы непрерывно), анимируется только скачок через «серое на сером»;
 * компоненты перерисовываются, лишь когда тема сменилась.
 */
function update(animate: boolean, fast = false) {
  const before = sky.ui, was = theme;
  sky = computeSky(pref);
  apply(animate && Math.abs(sky.ui - before) > (fast ? 0.15 : 0.02));
  if (!fast || theme !== was) listeners.forEach((l) => l());
  clockListeners.forEach((l) => l());
}

let fastTimer = 0;
function syncTicker() {
  if (clk.speed > 1 && pref === 'auto') {
    if (!fastTimer) fastTimer = window.setInterval(() => update(true, true), 100);
  } else if (fastTimer) {
    window.clearInterval(fastTimer);
    fastTimer = 0;
  }
}

/**
 * Перемотка неба «Авто»: скорость (1 — настоящее время, 600 — 10 минут в секунду, 3600 — час в секунду)
 * и/или момент. at: null — вернуться к настоящему времени.
 */
export function setSkyClock({ speed, at }: { speed?: number; at?: Date | null }) {
  const virt = at === null ? Date.now() : (at ?? liveAt()).valueOf();
  clk = { real: Date.now(), virt, speed: at === null ? 1 : speed ?? clk.speed };
  if (pref !== 'auto') setThemePref('auto');
  syncTicker();
  update(true);
}

/** Применить тему до первой отрисовки — без вспышки неверных цветов. */
export function initTheme() {
  readPalettes();
  sky = computeSky(pref);
  apply(false);
  window.setInterval(() => { if (pref === 'auto' && clk.speed === 1) update(true); }, 60_000);   // «Авто»: небо сдвигается раз в минуту
  window.addEventListener('storage', (e) => { if (e.key === KEY) { pref = readPref(); syncTicker(); update(true); } });
  syncTicker();
}

export function setThemePref(p: ThemePref, animate = true) {
  pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* только на эту вкладку */ }
  syncTicker();
  update(animate);
}

export const currentTheme = () => theme;
export const currentSky = () => sky;

export function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const { rise, set } = sunTimes(liveAt());
  return { pref, theme, sky, setPref: setThemePref, rise: fmtMsk(rise), set: fmtMsk(set) };
}

/** Часы неба для показа: время неба, скорость, идёт ли настоящее время (обновляется и при перемотке) */
export function useSkyClock() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    clockListeners.add(l);
    listeners.add(l);
    return () => { clockListeners.delete(l); listeners.delete(l); };
  }, []);
  return { at: liveAt(), speed: clk.speed, live: skyIsLive() };
}
