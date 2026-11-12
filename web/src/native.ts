/**
 * Сайт внутри приложения 404 для iPhone (WKWebView с меткой 404App в User-Agent) ведёт себя как приложение:
 * нет выделения текста, меню долгого нажатия и подсветки касаний, отзыв вибрацией на нажатия и тревоги.
 * `?app` в адресе включает те же стили в обычном браузере (для проверки на компьютере).
 */
export const inApp = /404App/.test(navigator.userAgent) || new URLSearchParams(location.search).has('app');
if (inApp) document.documentElement.classList.add('in-app');

export type Haptic = 'light' | 'medium' | 'success' | 'warning' | 'error';
/** Тактильный отклик iPhone; вне приложения ничего не делает */
export function haptic(kind: Haptic = 'light') {
  if (!inApp) return;
  try {
    (window as unknown as { webkit?: { messageHandlers?: { haptic?: { postMessage(m: string): void } } } }).webkit?.messageHandlers?.haptic?.postMessage(kind);
  } catch { /* не в приложении */ }
}

if (inApp) {
  // лёгкий отклик на нажатия кнопок, вкладок и переключателей (click — только настоящее нажатие, не прокрутка)
  document.addEventListener('click', (e) => {
    const t = (e.target as Element | null)?.closest?.('button, a[href], [role="tab"], [role="radio"], [role="switch"], select, .haptic');
    if (t && !(t as HTMLButtonElement).disabled) haptic('light');
  }, { capture: true, passive: true });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
