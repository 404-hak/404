/**
 * Оформление интерфейса — блоки, шрифты и кнопки:
 *   'upk'     — как на прошлом сайте команды (404 · УПК): плотные карточки с тенью, жирные цифры,
 *               крупные залитые кнопки, текст на шаг крупнее, подписи без моноширинного шрифта;
 *   'classic' — прежнее оформление дашборда.
 *
 * ОТКАТ: поменяйте DEFAULT на 'classic' — и сайт, и приложение для iPhone вернутся к прежнему виду
 * (стили 'upk' лежат отдельно в design-upk.css и без метки на <html> не действуют).
 * Сравнить на одном и том же сайте: добавьте к адресу ?design=classic или ?design=upk — выбор запомнится
 * в этом браузере; ?design=default — забыть выбор.
 */
export type Design = 'upk' | 'classic';
const DEFAULT: Design = 'upk';
const KEY = '404-design';

function pick(): Design {
  try {
    const q = new URLSearchParams(location.search).get('design');
    if (q === 'upk' || q === 'classic') localStorage.setItem(KEY, q);
    else if (q === 'default') localStorage.removeItem(KEY);
    const saved = localStorage.getItem(KEY);
    if (saved === 'upk' || saved === 'classic') return saved;
  } catch { /* приватный режим — берём вариант по умолчанию */ }
  return DEFAULT;
}

export const design: Design = pick();
document.documentElement.dataset.design = design;
