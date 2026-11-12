/**
 * Тема интерфейса: «Ночь», «День» или «Авто».
 * «Авто» — день, пока над дельтой Волги (район дежурства) светит солнце: восход и закат считаются
 * астрономически на текущую дату, время показывается по Москве (МСК), часовой пояс устройства не важен.
 */
import { useEffect, useState } from 'react';

export type ThemePref = 'night' | 'day' | 'auto';
export type Theme = 'night' | 'day';

const KEY = '404-theme';
const SITE = { lat: 45.73, lon: 48.0 };          // дельта Волги, центр района дежурства
const MSK = 'Europe/Moscow';

/** Восход и закат (официальные, −0,833° с учётом рефракции) на календарную дату по МСК. Алгоритм NOAA. */
export function sunTimes(at: Date = new Date(), lat = SITE.lat, lon = SITE.lon) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).split('-').map(Number);
  const day0 = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const n = Math.round((day0 - Date.UTC(parts[0], 0, 0)) / 864e5);
  const g = ((2 * Math.PI) / 365) * (n - 1 + 0.5);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const rad = Math.PI / 180;
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const h = Math.acos(Math.min(1, Math.max(-1, cosH))) / rad;
  const rise = new Date(day0 + (720 - 4 * (lon + h) - eq) * 60000);
  const set = new Date(day0 + (720 - 4 * (lon - h) - eq) * 60000);
  return { rise, set };
}

export const isDaylight = (at: Date = new Date()) => {
  const { rise, set } = sunTimes(at);
  return at >= rise && at < set;
};

export const fmtMsk = (d: Date) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit' }).format(d);

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'night' || v === 'day' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
};
const resolve = (p: ThemePref): Theme => (p === 'auto' ? (isDaylight() ? 'day' : 'night') : p);

let pref: ThemePref = readPref();
let theme: Theme = resolve(pref);
const listeners = new Set<() => void>();

function apply(animate: boolean) {
  const el = document.documentElement;
  if (animate) {
    el.classList.add('theme-anim');
    window.setTimeout(() => el.classList.remove('theme-anim'), 900);
  }
  el.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#E2E8F0' : '#0B1628');
}

function update(animate: boolean) {
  const next = resolve(pref);
  const changed = next !== theme;
  theme = next;
  if (changed || !animate) apply(animate && changed);
  listeners.forEach((l) => l());
}

/** Применить тему до первой отрисовки — без вспышки неверных цветов. */
export function initTheme() {
  apply(false);
  window.setInterval(() => { if (pref === 'auto') update(true); }, 60_000);   // «Авто»: проверка раз в минуту
  window.addEventListener('storage', (e) => { if (e.key === KEY) { pref = readPref(); update(true); } });
}

export function setThemePref(p: ThemePref) {
  pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* только на эту вкладку */ }
  update(true);
}

export const currentTheme = () => theme;

export function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const { rise, set } = sunTimes();
  return { pref, theme, setPref: setThemePref, rise: fmtMsk(rise), set: fmtMsk(set) };
}
