/**
 * Свет сцены на интерфейсе: листы, док и плашки освещены тем же солнцем или луной, что и небо.
 * Край, повёрнутый к светилу, бликует, тень падает от него; днём свет тёплый, ночью — холодный лунный.
 * Пишет в :root переменные --lx (−1 — светило слева, +1 — справа), --light (цвет, «r g b») и --lk (сила 0…1);
 * их читают правила .lit в design-upk.css. Считается раз в несколько секунд — это дёшево.
 */
import { currentSky, liveAt, skyBodies } from './theme';
import { palAt } from './skyPalette';

const MOON = '226 232 246';
let last = '';

function apply() {
  const sky = currentSky();
  const b = sky.pref === 'auto' ? skyBodies(liveAt()) : { sunAlt: sky.sunAlt, sun: sky.sun, moon: sky.moon };
  const sunK = b.sun.visible;
  const moonK = b.moon.visible * (0.35 + 0.65 * Math.max(0.15, b.moon.illum < 0 ? 0.6 : b.moon.illum));
  const useSun = sunK >= moonK;
  const body = useSun ? b.sun : b.moon;
  const lx = Math.max(-1, Math.min(1, (body.x - 0.5) * 2.4));
  const k = useSun ? 0.55 + 0.45 * sunK : 0.25 + 0.6 * moonK;
  const color = useSun ? palAt(b.sunAlt).sun.map((v) => Math.round(v * 255)).join(' ') : MOON;
  const key = `${lx.toFixed(2)}|${k.toFixed(2)}|${color}`;
  if (key === last) return;
  last = key;
  const el = document.documentElement.style;
  el.setProperty('--lx', lx.toFixed(3));
  el.setProperty('--lk', k.toFixed(3));
  el.setProperty('--light', color);
}

let started = false;
export function initSceneLight() {
  if (started) return;
  started = true;
  apply();
  window.setInterval(apply, 4000);
  window.addEventListener('storage', apply);
}
