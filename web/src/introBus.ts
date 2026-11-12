/** Повтор интро из любого места: клик по логотипу шлёт событие, App показывает заставку. */
export const INTRO_EVENT = '404:intro';
export const showIntro = () => window.dispatchEvent(new Event(INTRO_EVENT));

/**
 * Пока заставка закрывает экран, под ней ничего не должно отнимать кадры: фон не рисует,
 * гидрофон молчит (до начала растворения). Обновления с сервера копятся, пока заставка
 * вообще на экране, и применяются, когда она ушла, — перерисовка дашборда не дёргает анимацию.
 */
let cover = false, playing = false;
const finished = new Set<() => void>();
export const introCovering = () => cover;
export const introPlaying = () => playing;
export function setIntroCover(on: boolean) { cover = on; }
export function setIntroPlaying(on: boolean) {
  if (playing === on) return;
  playing = on;
  if (!on) finished.forEach((f) => f());
}
export function onIntroFinished(f: () => void) {
  finished.add(f);
  return () => { finished.delete(f); };
}

/**
 * Дашборд пришёл в себя: первый снимок получен и страница отрисована. Заставка ждёт этого
 * перед стартом, чтобы тяжёлая первая отрисовка карты не дёргала анимацию.
 */
let settled = false;
const settleSubs = new Set<() => void>();
export function appSettled() {
  if (settled) return;
  settled = true;
  settleSubs.forEach((f) => f());
}
export function whenAppSettled(f: () => void) {
  if (settled) { f(); return () => {}; }
  settleSubs.add(f);
  return () => { settleSubs.delete(f); };
}
