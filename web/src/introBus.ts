/** Повтор интро из любого места: клик по логотипу шлёт событие, App показывает заставку. */
export const INTRO_EVENT = '404:intro';
export const showIntro = () => window.dispatchEvent(new Event(INTRO_EVENT));
