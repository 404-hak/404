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

/**
 * Раскладка экрана:
 *   'delta'  — «Карта — всё»: живая дельта на весь экран, разделы листом поверх карты, док внизу;
 *   'panels' — прежняя: боковое меню, шапка и страницы.
 * ОТКАТ: DEFAULT_LAYOUT = 'panels'; сравнить — ?layout=panels или ?layout=delta (запоминается), ?layout=default — забыть.
 * Прежнее оформление (?design=classic) всегда с прежней раскладкой.
 */
export type Layout = 'delta' | 'panels';
const DEFAULT_LAYOUT: Layout = 'delta';
const LAYOUT_KEY = '404-layout';
function pickLayout(): Layout {
  if (design === 'classic') return 'panels';
  try {
    const q = new URLSearchParams(location.search).get('layout');
    if (q === 'delta' || q === 'panels') localStorage.setItem(LAYOUT_KEY, q);
    else if (q === 'default') localStorage.removeItem(LAYOUT_KEY);
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved === 'delta' || saved === 'panels') return saved;
  } catch { /* приватный режим */ }
  return DEFAULT_LAYOUT;
}
export const layout: Layout = pickLayout();
document.documentElement.dataset.layout = layout;

/**
 * Цвет «повышенного риска». В оформлении «УПК» вместо яркого оранжевого — приглушённый янтарь
 * с прошлого сайта, и только в мелких отметках (см. design-upk.css); в прежнем — как было.
 */
export const WARN = design === 'upk'
  ? { night: '#E2B65E', day: '#946713', rgb: [226, 182, 94] as [number, number, number] }
  : { night: '#F59E0B', day: '#8F5406', rgb: [245, 158, 11] as [number, number, number] };
