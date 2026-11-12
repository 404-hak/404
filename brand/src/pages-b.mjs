// 404 · страницы: раздел 04 «Типографика» → конец
import * as G from './geometry.mjs';
import { C, MM, pn, page, top, box, rows, divider, T_DARK, T_LIGHT, fx, ratio } from './ui.mjs';
import { tokensCss, tailwindPreset } from './tokens.mjs';

const { MARK, WORD, LOCKUP_H, LOCKUP_V } = G;
const M = (fill, style) => G.inlineMark(fill, style);
const markAt = (cx, cy, h, fill) => { const k = h / MARK.h; return `<g transform="translate(${cx - MARK.w * k / 2} ${cy - h / 2}) scale(${k})"><path fill="${fill}" d="${MARK.d}"/></g>`; };
const LH = (fill, style) => G.inlineLockup('horizontal', fill, style);
const LV = (fill, style) => G.inlineLockup('stacked', fill, style);
const rg = h => G.rgbOf(h).join(' ');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ===== РАЗДЕЛ 04 =====
export const d04 = () => divider('d04', '04', 'Типографика', 'Шрифты Inter и JetBrains Mono, шкала размеров и правила набора', [
  ['4.1', 'Шрифт Inter', 'p41'], ['4.2', 'Шрифт для данных', 'p42'], ['4.3', 'Шкала и правила набора', 'p43']]);

export function p41() {
  const w = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold']];
  const sample = ([n, t], i) => box(`left:${683 + (i % 2) * 221}px;top:${i < 2 ? 205 : 327}px;width:203px;border-top:1px solid var(--ln)`,
    `<div style="font-weight:${n};font-size:42px;line-height:52px;margin-top:8px;letter-spacing:-.01em">Aa Kk</div><div class="t11" style="margin-top:8px"><b style="color:var(--bg)">${n}</b> · ${t}</div>`);
  const alph = [
    ['Кириллица · прописные', 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'],
    ['Кириллица · строчные', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'],
    ['Латиница · прописные', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['Латиница · строчные', 'abcdefghijklmnopqrstuvwxyz'],
    ['Цифры', '0123456789'],
  ];
  return page('p41', 'light', `
    ${top('4.1', 'Шрифт Inter', 'Четыре начертания: Light 300, Regular 400, Medium 500 и SemiBold 600. Полная кириллица и латиница.')}
    ${box('left:58px;top:176px;font-weight:300;font-size:184px;line-height:1;letter-spacing:-.035em', 'Inter')}
    ${box('left:63px;top:372px;width:560px', '<div class="t12" style="font-size:12.5px;line-height:19px">Основной шрифт бренда — для заголовков, текста, интерфейса. Лицензия SIL Open Font License 1.1 — бесплатен для коммерческого использования. Источник: rsms.me/inter, Google Fonts. Замена в офисных документах — Arial.</div>')}
    ${w.map(sample).join('')}
    ${box('left:63px;top:467px;width:1044px;border-top:1px solid var(--ln)', alph.map(([l, s]) => `
      <div style="display:grid;grid-template-columns:177px 1fr;align-items:center;height:50.4px;border-bottom:1px solid var(--ln)">
        <div class="cap" style="font-size:9px">${l}</div><div style="font-size:22px;letter-spacing:.005em">${s}</div></div>`).join(''))}
  `, { label: 'Типографика', num: '04' });
}

export function p42() {
  const dc = (x, y, l, big, sub, size = 26) => box(`left:${x}px;top:${y}px;width:290px;height:128px`, `
    <div class="card" style="position:absolute;inset:0"></div>
    <div class="abs cap" style="left:20px;top:18px">${l}</div>
    <div class="abs mono" style="left:20px;top:44px;font-weight:500;font-size:${size}px;line-height:${size + 8}px;letter-spacing:-.01em">${big}</div>
    <div class="abs t11" style="left:20px;bottom:16px">${sub}</div>`);
  const bullets = [
    'Только для данных: координаты, время, расстояния, идентификаторы буёв, хэши и числа в таблицах.',
    'Заголовки и обычный текст — только Inter.',
    'Начертания: Regular 400 и Medium 500; трекинг 0, интерлиньяж 20 px при 13 px.',
    'Единицы измерения (км, мин, %) набираются тем же шрифтом, в той же строке.',
  ];
  return page('p42', 'dark', `
    ${top('4.2', 'Шрифт для данных', 'Моноширинный JetBrains Mono — для всего, что инспектор читает как данные: координаты, время, расстояния, идентификаторы, хэши.')}
    ${box('left:60px;top:196px;font-weight:400;font-size:68px;line-height:76px;letter-spacing:-.03em;white-space:nowrap', 'JetBrains Mono')}
    ${box('left:63px;top:284px;width:560px', '<div class="t12" style="font-size:12.5px;line-height:19px">Второй шрифт бренда. Лицензия SIL Open Font License 1.1 — бесплатен для коммерческого использования. Источник: jetbrains.com/lp/mono, Google Fonts. Примеры ниже — иллюстрация, не реальные данные.</div>')}
    ${dc(63, 372, 'Координаты', '46.0412° N<br>48.2287° E', '', 21)}
    ${dc(373, 372, 'Время', '23:15:07', 'Пятница · безлунная ночь', 30)}
    ${dc(63, 520, 'Дистанция', '3.2 км', 'Перехват через 12 мин', 30)}
    ${dc(373, 520, 'Хэш SHA-256', '9f2c4a7e…b81d', 'Доказательный пакет', 21)}
    ${box('left:683px;top:203px', '<span class="cap">Начертания</span>')}
    ${[[400, 'Regular'], [500, 'Medium']].map(([n, t], i) => box(`left:${683 + i * 221}px;top:225px;width:203px;border-top:1px solid var(--ln)`,
      `<div class="mono" style="font-weight:${n};font-size:40px;line-height:50px;margin-top:8px;letter-spacing:-.02em">Aa 09</div><div class="t11" style="margin-top:8px"><b style="color:var(--primary)">${n}</b> · ${t}</div>`)).join('')}
    ${box('left:683px;top:352px', '<span class="cap">Правила</span>')}
    ${box('left:683px;top:374px;width:424px;border-top:1px solid var(--ln)', bullets.map(b => `
      <div style="display:grid;grid-template-columns:20px 1fr;padding:11px 0;border-bottom:1px solid var(--ln);font-size:12.5px;line-height:18px;color:var(--tx2)"><span class="dot" style="background:var(--acc);width:6px;height:6px;margin-top:6px"></span><span>${b}</span></div>`).join(''))}
  `, { label: 'Типографика', num: '04' });
}

export function p43() {
  const L = [
    ['Дисплей', 'Light 300 · 56 / 60 px · трекинг −1 %', 'font-weight:300;font-size:56px;line-height:60px;letter-spacing:-.01em', 'Бренд-гайд', 98],
    ['Заголовок', 'SemiBold 600 · 30 / 36 px · трекинг −1 %', 'font-weight:600;font-size:30px;line-height:36px;letter-spacing:-.01em', 'Логотип и знак', 66],
    ['Подзаголовок', 'Medium 500 · 20 / 28 px · трекинг 0', 'font-weight:500;font-size:20px;line-height:28px', 'Охранное поле и минимальный размер', 62],
    ['Основной текст', 'Regular 400 · 16 / 24 px · трекинг 0', 'font-size:16px;line-height:24px', 'Знак не растягивается и не поворачивается.', 62],
    ['Мелкий текст', 'Regular 400 · 13 / 20 px · трекинг 0', 'font-size:13px;line-height:20px', 'Подписи к изображениям, сноски и служебный текст.', 62],
    ['Метка', 'SemiBold 600, ПРОПИСНЫЕ · 11 / 16 px · трекинг +16 %', 'font-weight:600;font-size:11px;line-height:16px;letter-spacing:.16em', 'РАЗДЕЛ 04 · ТИПОГРАФИКА', 62],
    ['Данные', 'JetBrains Mono Medium 500 · 13 / 20 px', "font-family:'JetBrains Mono';font-weight:500;font-size:13px;line-height:20px", '46.0412° N 48.2287° E · 23:15:07', 62],
  ];
  const rowsHTML = L.map(([n, s, st, t, h]) => `
    <div style="display:grid;grid-template-columns:232px 1fr;align-items:center;height:${h}px;border-bottom:1px solid var(--ln)">
      <div><div style="font-weight:600;font-size:12.5px">${n}</div><div class="t11" style="font-size:10px;line-height:14px;margin-top:2px;padding-right:12px">${s}</div></div>
      <div style="${st}">${t}</div></div>`).join('');
  const rules = [
    'Набор — выключка влево, без переносов в заголовках.',
    'Прописные — только для меток и коротких надзаголовков, с трекингом +14–16 %.',
    'Цифры в таблицах — моноширинные (tabular-nums); данные — JetBrains Mono.',
    'Длинный текст — Regular 400; Bold 700 в наборе не используется.',
    'Надпись 404 в логотипе — не набор, а отрисованный знак: используйте файлы из пакета.',
  ];
  return page('p43', 'light', `
    ${top('4.3', 'Шкала и правила набора', 'Семь уровней для экрана; в печати сохраняйте те же соотношения кегля и интерлиньяжа. Каждая строка шкалы набрана своим стилем.')}
    ${box('left:63px;top:204px', '<span class="cap">Шкала · кегль / интерлиньяж</span>')}
    ${box('left:63px;top:226px;width:672px;border-top:1px solid var(--ln)', rowsHTML)}
    ${box('left:772px;top:204px', '<span class="cap">Правила набора</span>')}
    ${box('left:772px;top:226px;width:335px;border-top:1px solid var(--ln)', rules.map(b => `
      <div style="display:grid;grid-template-columns:20px 1fr;padding:13px 0;border-bottom:1px solid var(--ln);font-size:12.5px;line-height:18px;color:var(--tx2)"><span class="dot" style="background:var(--bg);width:6px;height:6px;margin-top:6px"></span><span>${b}</span></div>`).join(''))}
  `, { label: 'Типографика', num: '04' });
}

// ===== РАЗДЕЛ 05 =====
export const d05 = () => divider('d05', '05', 'Логотип на фонах', 'Знак на фирменных цветах, иконки и фавикон', [
  ['5.1', 'Знак на фирменных цветах', 'p51'], ['5.2', 'Иконки и фавикон', 'p52']]);

export function p51() {
  const xs = [63, 329, 595, 860];
  const L = [
    ['Background · Ночной', C.bg, C.primary, 'bgc', 'Primary'],
    ['Primary · Пенный', C.primary, C.bg, 'pc', 'Background'],
    ['Grey · Сланцевый', C.grey, C.primary, 'gc', 'Primary'],
    ['Accent · Бирюзовый', C.accent, C.bg, 'ac', 'Background'],
  ];
  const html = L.map(([n, bg, fg, cls, fgn], i) => {
    const c = G.contrast(fg, bg);
    return `
      <div class="card ${cls} ctr" style="left:${xs[i]}px;top:205px;width:246px;height:306px">${M(fg, 'height:150px;width:auto')}</div>
      <div class="card ${cls} ctr" style="left:${xs[i]}px;top:527px;width:246px;height:110px">${LH(fg, 'width:156px;height:auto')}</div>
      ${box(`left:${xs[i]}px;top:659px;width:246px`, `<div style="font-weight:600;font-size:14px">${n}</div><div class="t11" style="margin-top:5px">${bg}<br>Знак ${fgn} · ${ratio(fg, bg)}:1 · ${G.wcag(c)}</div>`)}`;
  }).join('');
  return page('p51', 'dark', `
    ${top('5.1', 'Знак на фирменных цветах', 'Цвет знака на каждом фирменном фоне фиксирован: на Background и Grey — Primary, на Primary и Accent — Background.')}
    ${html}
  `, { label: 'Логотип на фонах', num: '05' });
}

export function p52() {
  const tile = (size, bg, fg, border = false, r = .224, frac = .62) =>
    `<div style="width:${size}px;height:${size}px;border-radius:${size * r}px;background:${bg};${border ? 'border:1px solid var(--line-l);' : ''}display:flex;align-items:center;justify-content:center;flex:none">${M(fg, `height:${size * frac}px;width:auto`)}</div>`;
  const tab = (dark) => {
    const bgc = dark ? C.surface : '#CBD5E1', tabBg = dark ? '#0F1D33' : C.primary, tx = dark ? C.primary : C.bg;
    return `<div style="border-radius:12px;background:${bgc};border:1px solid ${dark ? 'var(--line-d)' : 'var(--line-l)'};padding:12px 12px 0;overflow:hidden;height:80px">
      <div style="width:230px;height:34px;border-radius:9px 9px 0 0;background:${tabBg};display:flex;align-items:center;gap:9px;padding:0 12px;color:${tx};font-size:12px">
        ${tile(16, dark ? C.surface : C.bg, C.primary, false, .22, .8)}404 — бренд-гайд</div>
      <div style="height:34px;background:${tabBg};margin:0 -12px"><div style="margin:9px 12px 0;height:16px;border-radius:8px;width:220px;background:${dark ? C.surface : '#CBD5E1'}"></div></div></div>`;
  };
  const files = [
    ['favicon.ico', '16, 32, 48 px — сайт'],
    ['favicon.svg', 'вектор для современных браузеров'],
    ['favicon-32.png', '32 × 32 px'],
    ['apple-touch-icon.png', '180 × 180 px — iOS'],
    ['icon-192.png, icon-512.png', 'Android, веб-приложение (PWA)'],
  ];
  return page('p52', 'light', `
    ${top('5.2', 'Иконки и фавикон', 'Для иконок и фавикона используется только знак: при малом размере надпись нечитаема.')}
    ${box('left:63px;top:204px', '<span class="cap">Иконка приложения · 1024 × 1024 px</span>')}
    ${box('left:63px;top:232px', tile(213, C.bg, C.primary))}
    ${box('left:303px;top:232px', tile(213, C.primary, C.bg, true))}
    ${box('left:63px;top:456px', '<div style="font-weight:600;font-size:12px">Основная</div><div class="t11" style="margin-top:3px">404-icon-dark-1024.png</div>')}
    ${box('left:303px;top:456px', '<div style="font-weight:600;font-size:12px">Светлая</div><div class="t11" style="margin-top:3px">404-icon-light-1024.png</div>')}
    ${box('left:63px;top:513px;width:512px;height:1px;background:var(--ln)')}
    ${box('left:63px;top:534px', tile(80, C.bg, C.primary, false, 0))}
    ${box('left:151px;top:534px', tile(80, C.primary, C.bg, true, 0))}
    ${box('left:262px;top:546px;width:300px', '<div class="t11" style="font-size:11px;line-height:16px">Квадратные версии …-square-1024.png — для магазинов приложений: скругление углов задаёт платформа.</div>')}
    ${box('left:63px;top:650px;width:512px', '<div class="t12" style="font-size:12.5px;line-height:19px">Иконка — только знак, без надписи, на плашке Background (основная) или Primary (светлая). Знак — по центру, высота знака — 62 % стороны иконки; в фавиконе — 78 %, с утолщением штрихов для мелких размеров.</div>')}
    ${box('left:683px;top:204px', '<span class="cap">Фавикон</span>')}
    ${box('left:683px;top:226px;width:424px', tab(true))}
    ${box('left:683px;top:318px;width:424px', tab(false))}
    ${box('left:683px;top:420px;display:flex;align-items:flex-end;gap:22px', `<div>${tile(48, C.bg, C.primary, false, .224, .78)}<div class="t11" style="margin-top:7px">48 px</div></div><div>${tile(32, C.bg, C.primary, false, .224, .78)}<div class="t11" style="margin-top:7px">32 px</div></div><div>${tile(16, C.bg, C.primary, false, .224, .8)}<div class="t11" style="margin-top:7px">16 px</div></div>`)}
    ${box('left:683px;top:518px;width:424px', rows(files, { cols: 'c2' }).replace(/class="tr c2"/g, 'class="tr" style="grid-template-columns:182px 1fr;min-height:40px"'))}
  `, { label: 'Логотип на фонах', num: '05' });
}

// ===== РАЗДЕЛ 06 =====
export const d06 = () => divider('d06', '06', 'Недопустимое<br>использование', 'Чего нельзя делать со знаком', [['6.1', 'Ошибки использования', 'p61']]);

export function p61() {
  const xs = [63, 329, 595, 860], ys = [205, 484];
  const bad = (inner, bgStyle = '') => `<div class="abs ctr" style="inset:0;${bgStyle}">${inner}</div><div class="abs" style="right:14px;top:14px;width:22px;height:22px;border-radius:50%;background:${C.alert}"><svg width="22" height="22" viewBox="0 0 22 22"><path d="M7.5,7.5 L14.5,14.5 M14.5,7.5 L7.5,14.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg></div>`;
  const circles = [[30, 40, 34, '#EF4444'], [90, 30, 30, '#F59E0B'], [150, 60, 36, '#8B5CF6'], [200, 40, 26, '#22C55E'], [50, 120, 30, '#3B82F6'], [120, 110, 38, '#EC4899'], [200, 120, 32, '#F59E0B'], [40, 180, 34, '#22C55E'], [110, 175, 28, '#3B82F6'], [190, 170, 36, '#EF4444']];
  const party = `<svg width="246" height="208" viewBox="0 0 246 208" style="position:absolute;inset:0">${circles.map(([x, y, r, c]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity=".85"/>`).join('')}<path d="M0,150 L160,0 M60,208 L246,60 M120,208 L246,120" stroke="#E2E8F0" stroke-width="9" opacity=".7"/><path d="M0,60 L110,0 M20,208 L220,0" stroke="#3B82F6" stroke-width="7" opacity=".8"/></svg><div class="abs ctr" style="inset:0">${M(C.primary, 'height:108px;width:auto')}</div>`;
  const items = [
    ['Не растягивать и не сжимать', bad(M(C.primary, 'height:96px;width:auto;transform:scaleX(1.45)'))],
    ['Не поворачивать', bad(M(C.primary, 'height:100px;width:auto;transform:rotate(-17deg)'))],
    ['Не красить в статусные и другие цвета вне фирменных', bad(M(C.alert, 'height:104px;width:auto'))],
    ['Не добавлять тени, свечение и обводку', bad(M(C.primary, `height:104px;width:auto;filter:drop-shadow(6px 9px 5px rgba(0,0,0,.7)) drop-shadow(0 0 14px rgba(45,212,191,.9))`))],
    ['Не размещать на фоне с низким контрастом', bad(M(G.mix(C.primary, C.surface, .13), 'height:104px;width:auto'))],
    ['Не менять пропорции и положение надписи', bad(`<div style="display:flex;align-items:flex-end;gap:6px">${M(C.primary, 'height:84px;width:auto')}${G.inlineWord(C.primary, 'width:118px;height:auto;margin-bottom:-4px')}</div>`)],
    ['Не использовать контурную версию', bad(`<svg viewBox="0 0 ${MARK.w} ${MARK.h}" style="height:104px;width:auto"><path d="${MARK.d}" fill="none" stroke="${C.primary}" stroke-width="6" stroke-linejoin="round"/></svg>`)],
    ['Не размещать на пёстром фоне без затемнения', `${party}<div class="abs" style="right:14px;top:14px;width:22px;height:22px;border-radius:50%;background:${C.alert}"><svg width="22" height="22" viewBox="0 0 22 22"><path d="M7.5,7.5 L14.5,14.5 M14.5,7.5 L7.5,14.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg></div>`],
  ];
  const cells = items.map(([t, inner], i) => {
    const x = xs[i % 4], y = ys[Math.floor(i / 4)];
    return `<div class="card" style="left:${x}px;top:${y}px;width:246px;height:208px">${inner}</div>
      ${box(`left:${x}px;top:${y + 220}px;width:246px;display:grid;grid-template-columns:28px 1fr;font-size:12.5px;line-height:17px`, `<b style="color:var(--acc);font-weight:600">0${i + 1}</b><span>${t}</span>`)}`;
  }).join('');
  return page('p61', 'dark', `
    ${top('6.1', 'Ошибки использования', 'Знак и логотип используются только в исходном виде — из файлов пакета. Ниже — типичные ошибки.')}
    ${cells}
  `, { label: 'Недопустимое использование', num: '06' });
}

// ===== РАЗДЕЛ 07 =====
export const d07 = () => divider('d07', '07', 'Применение', 'Интерфейс, состояния, голос системы, носители и мерч', [
  ['7.1', 'Дашборд', 'p71'], ['7.2', 'Пять состояний', 'p72'], ['7.3', 'Голос системы', 'p73'], ['7.4', 'Носители и мерч', 'p74']]);

// узел «кольцо с точкой» для карт и схем
const nodeSVG = (x, y, r, c, op = 1) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${r * .34}" opacity="${op}"/><circle cx="${x}" cy="${y}" r="${r * .32}" fill="${c}" opacity="${op}"/>`;

export function p71() {
  const mapW = 468, mapH = 495;
  const buoys = [[70, 120], [190, 78], [330, 120], [130, 235], [292, 190], [410, 250], [58, 330], [262, 372], [388, 400], [340, 450]];
  const links = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5], [3, 6], [4, 7], [7, 8], [7, 9], [8, 9], [5, 8]];
  const alertIdx = 4, warnIdx = [1, 2];
  const grid = [...Array(13).keys()].map(i => `<path d="M${i * 40},0 V${mapH}" stroke="${C.surface}" stroke-width="1"/>`).join('') +
    [...Array(13).keys()].map(i => `<path d="M0,${i * 40} H${mapW}" stroke="${C.surface}" stroke-width="1"/>`).join('');
  const ch = ['M-10,300 C80,260 120,330 200,300 S330,230 480,260', 'M150,-10 C170,80 120,160 160,250 S230,400 210,510', 'M300,-10 C320,90 380,140 360,230 S300,380 340,510', 'M-10,60 C90,40 160,110 260,90 S420,40 480,70']
    .map(d => `<path d="${d}" stroke="${C.surface}" stroke-width="22" fill="none" stroke-linecap="round"/>`).join('');
  const route = `M132,392 C150,350 190,318 228,282 S272,222 ${buoys[alertIdx][0]},${buoys[alertIdx][1] + 14}`;
  const map = `<svg width="${mapW}" height="${mapH}" viewBox="0 0 ${mapW} ${mapH}" style="position:absolute;left:0;top:48px">
    ${grid}${ch}
    <polygon points="140,34 380,60 392,168 250,160 150,120" fill="${C.warn}" fill-opacity=".09" stroke="${C.warn}" stroke-opacity=".6" stroke-dasharray="5 4"/>
    ${links.map(([a, b]) => `<path d="M${buoys[a]} L${buoys[b]}" stroke="${C.accent}" stroke-opacity=".32" stroke-width="1.2"/>`).join('')}
    <circle cx="${buoys[alertIdx][0]}" cy="${buoys[alertIdx][1]}" r="58" fill="none" stroke="${C.alert}" stroke-opacity=".16" stroke-width="1.5"/>
    <circle cx="${buoys[alertIdx][0]}" cy="${buoys[alertIdx][1]}" r="38" fill="${C.alert}" fill-opacity=".1" stroke="${C.alert}" stroke-opacity=".4" stroke-width="1.5"/>
    <path d="${route}" fill="none" stroke="${C.primary}" stroke-width="1.8" stroke-dasharray="6 5"/>
    ${buoys.map(([x, y], i) => nodeSVG(x, y, i === alertIdx ? 11 : 8, i === alertIdx ? C.alert : warnIdx.includes(i) ? C.warn : C.accent)).join('')}
    <circle cx="132" cy="392" r="7" fill="${C.primary}"/><circle cx="132" cy="392" r="14" fill="none" stroke="${C.primary}" stroke-opacity=".4"/>
    <text x="${buoys[alertIdx][0] + 18}" y="${buoys[alertIdx][1] - 14}" font-family="JetBrains Mono" font-weight="500" font-size="10" fill="${C.primary}">БУЙ-4</text>
    <text x="212" y="326" font-family="JetBrains Mono" font-weight="500" font-size="10" fill="${C.primary}">3.2 км</text>
    <text x="112" y="420" font-family="JetBrains Mono" font-size="10" fill="${T_DARK}">Вы</text>
  </svg>`;
  const bars = [8, 14, 10, 22, 30, 18, 34, 26, 38, 24, 30, 16, 26, 12, 20, 9, 14, 7].map((h, i) => `<rect x="${i * 11}" y="${42 - h}" width="5" height="${h}" rx="2" fill="${C.alert}" opacity="${.45 + h / 70}"/>`).join('');
  const chip = (t, v, c = C.primary) => `<div style="background:${C.surface};border:1px solid rgba(226,232,240,.12);border-radius:9px;padding:7px 10px"><div class="mono" style="font-size:9px;color:${T_DARK};letter-spacing:.06em">${t}</div><div class="mono" style="font-weight:500;font-size:14px;color:${c};margin-top:2px">${v}</div></div>`;
  const ui = `
    <div class="abs" style="left:0;top:0;right:0;height:48px;background:${C.surface};border-bottom:1px solid rgba(226,232,240,.1);display:flex;align-items:center;justify-content:space-between;padding:0 16px">
      ${LH(C.primary, 'height:17px;width:auto')}
      <div class="mono" style="font-size:10px;letter-spacing:.08em;color:${T_DARK}">СЕКТОРЫ 1–9 · ДЕЖУРСТВО</div>
      <div style="display:flex;align-items:center;gap:14px"><span class="mono" style="font-size:12px;font-weight:500">23:15</span><span class="mono" style="font-size:10px;font-weight:500;color:${C.alert};letter-spacing:.08em;display:flex;align-items:center;gap:6px"><span class="dot" style="background:${C.alert};width:7px;height:7px"></span>ТРЕВОГА</span></div>
    </div>
    ${map}
    <div class="abs" style="left:14px;bottom:14px;display:flex;gap:8px">${chip('РИСК НОЧИ', '91 %', C.warn)}${chip('ВОДА', '+12°')}${chip('ЛУНА', '0 %')}</div>
    <div class="abs" style="left:${mapW}px;top:48px;right:0;bottom:0;background:${C.surface};border-left:1px solid rgba(226,232,240,.1);padding:18px 18px">
      <div class="mono" style="font-size:10px;font-weight:500;color:${C.alert};letter-spacing:.08em">● ТРЕВОГА · 23:15:07</div>
      <div style="font-weight:600;font-size:16px;line-height:21px;margin-top:10px">Буй Камышовый-4 услышал мотор</div>
      <div style="font-size:12px;line-height:18px;color:${T_DARK};margin-top:8px">Похоже на тот же катер, что был здесь 5 мая (89 %). До цели 3,2 км.</div>
      <svg width="190" height="46" viewBox="0 0 190 46" style="margin-top:14px">${bars}</svg>
      <div class="mono" style="font-size:10.5px;line-height:17px;color:${T_DARK};margin-top:12px">46.0412° N 48.2287° E<br>SHA-256 9f2c…b81d</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <div style="flex:1;height:34px;border-radius:9px;background:${C.alert};color:${C.bg};font-weight:600;font-size:12.5px;display:flex;align-items:center;justify-content:center">Перехват</div>
        <div style="flex:1;height:34px;border-radius:9px;border:1px solid rgba(226,232,240,.3);font-weight:600;font-size:12.5px;display:flex;align-items:center;justify-content:center">Отчёт</div>
      </div>
    </div>`;
  const spec = rows([
    ['Фон экрана', 'Background'],
    ['Карточки, панели', 'Surface'],
    ['Узлы сети, норма', 'Accent'],
    ['Предупреждение', 'Warning'],
    ['Тревога', 'Alert'],
    ['Текст, маршрут', 'Primary / Primary 70 %'],
    ['Данные', 'JetBrains Mono'],
    ['Заголовки и текст', 'Inter'],
  ], { cols: '' }).replace(/class="tr "/g, 'class="tr" style="grid-template-columns:134px 1fr;min-height:34px;font-size:12px"');
  return page('p71', 'dark', `
    ${top('7.1', 'Дашборд', 'Рабочий экран инспектора: тёмный интерфейс на цветах бренда. Буи на карте — кольцо с точкой, как нуль в надписи 404.')}
    <div class="card bgc" style="left:63px;top:205px;width:697px;height:543px">${ui}</div>
    ${box('left:783px;top:203px', '<span class="cap">Что взято из брендбука</span>')}
    ${box('left:783px;top:225px;width:324px', spec)}
    ${box('left:783px;top:520px;width:324px', '<div class="t12" style="font-size:12.5px;line-height:19px">Тёмная тема — рабочая: инспектор дежурит ночью, экран не слепит, не выдаёт позицию и экономит батарею.</div>')}
    ${box('left:783px;top:607px;width:324px;border-top:1px solid var(--ln);padding-top:11px', '<div class="t11" style="line-height:17px">Схематичный макет: компоновка и цифры — иллюстрация палитры и шрифтов, не реальные данные.</div>')}
  `, { label: 'Применение', num: '07' });
}

export function p72() {
  const base = [[30, 34], [90, 22], [150, 40], [60, 80], [120, 84], [168, 96]];
  const lk = [[0, 1], [1, 2], [0, 3], [1, 4], [3, 4], [2, 4], [4, 5], [2, 5]];
  const net = (hi = {}) => `${lk.map(([a, b]) => `<path d="M${base[a]} L${base[b]}" stroke="${C.accent}" stroke-opacity=".35" stroke-width="1"/>`).join('')}${base.map(([x, y], i) => nodeSVG(x, y, 5.5, hi[i] || C.accent)).join('')}`;
  const mini = [
    net(),
    `<polygon points="70,8 176,18 180,70 100,64" fill="${C.warn}" fill-opacity=".12" stroke="${C.warn}" stroke-opacity=".7" stroke-dasharray="4 3"/>${net({ 1: C.warn, 2: C.warn })}`,
    `<circle cx="120" cy="84" r="34" fill="${C.alert}" fill-opacity=".1" stroke="${C.alert}" stroke-opacity=".45"/><circle cx="120" cy="84" r="52" fill="none" stroke="${C.alert}" stroke-opacity=".2"/>${net({ 4: C.alert })}`,
    `${net({ 4: C.alert })}<path d="M26,108 C50,100 70,92 120,84" fill="none" stroke="${C.primary}" stroke-width="1.6" stroke-dasharray="5 4"/><circle cx="26" cy="108" r="5" fill="${C.primary}"/>`,
    `<rect x="46" y="12" width="104" height="100" rx="8" fill="${C.surface}" stroke="rgba(226,232,240,.3)"/><path d="M60,32 H120 M60,46 H136 M60,60 H110" stroke="${C.primary}" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/><text x="60" y="86" font-family="JetBrains Mono" font-size="8" fill="${T_DARK}">SHA-256 9f2c…b81d</text><circle cx="136" cy="98" r="9" fill="${C.accent}"/><path d="M131.5,98 L135,101.5 L141,94.5" stroke="${C.bg}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ];
  const S = [
    ['Спокойствие', C.accent, 'Бирюзовый', 'Карта бирюзовая, индекс здоровья, прогноз на ночь', '«Полнолуние, понедельник. Риск низкий»'],
    ['Настороженность', C.warn, 'Янтарный', '2 сектора подсвечены янтарным', '«Безлунная ночь, пятница, вода +12°. Рекомендую усилить сектор 7»'],
    ['Тревога', C.alert, 'Коралловый', 'Красная пульсация, звуковой сигнал, карточка алерта', '«Буй-4: мотор. Совпадение с катером от 05.05 (89 %). Дистанция 3,2 км»'],
    ['Перехват', C.alert, 'Коралловый цель · Пенный маршрут', 'Карта в режиме навигации', '«До цели 1,8 км. Перехват через 12 мин через протоку Старая»'],
    ['Документирование', C.primary, 'Пенный', 'Автозаполненная форма отчёта', '«Отчёт готов. Аудио, координаты, хэш прикреплены. Отправить?»'],
  ];
  const cards = S.map(([n, col, cn, scr, say], i) => {
    const x = 63 + i * 212;
    return `
      <div class="abs" style="left:${x + 98}px;top:218px;width:0"></div>
      <div class="card" style="left:${x}px;top:238px;width:196px;height:430px">
        <div class="abs" style="left:0;right:0;top:0;height:4px;background:${col}"></div>
        <div class="abs" style="left:16px;top:20px;right:16px"><div class="mono" style="font-size:10px;color:var(--tx2)">0${i + 1}</div><div style="font-weight:600;font-size:16px;line-height:20px;margin-top:4px">${n}</div></div>
        <div class="abs" style="left:14px;top:70px;width:166px;height:104px;border-radius:10px;background:${C.bg};overflow:hidden"><svg width="166" height="104" viewBox="0 8 196 112" preserveAspectRatio="xMidYMid meet">${mini[i]}</svg></div>
        <div class="abs" style="left:16px;top:188px;right:16px"><div class="cap" style="font-size:8.5px">Система говорит</div><div style="font-weight:500;font-size:12.5px;line-height:18px;margin-top:6px">${say}</div></div>
        <div class="abs" style="left:16px;top:316px;right:16px"><div class="cap" style="font-size:8.5px">На экране</div><div class="t11" style="margin-top:6px;font-size:11.5px">${scr}</div></div>
        <div class="abs" style="left:16px;bottom:14px;right:16px;display:flex;align-items:center;gap:8px;font-size:10.5px;line-height:14px;color:var(--tx2)"><span class="dot" style="flex:none;background:${col};${col === C.primary ? 'border:1px solid var(--line-l);' : ''}"></span>${cn}</div>
      </div>`;
  }).join('');
  const flow = `<svg width="1044" height="20" viewBox="0 0 1044 20" style="position:absolute;left:63px;top:206px">
    <path d="M98,10 H946" stroke="rgba(11,22,40,.35)" stroke-width="1.2"/>
    ${S.map(([, c], i) => `<circle cx="${98 + i * 212}" cy="10" r="6" fill="${c === C.primary ? C.bg : c}"/>`).join('')}</svg>`;
  return page('p72', 'light', `
    ${top('7.2', 'Пять состояний дашборда', 'Система сама переключается и показывает нужное: от спокойствия до документирования. У каждого состояния — свой ведущий цвет и свой голос.')}
    ${flow}${cards}
    ${box('left:63px;top:686px;width:760px', '<div class="t12" style="font-size:12.5px;line-height:19px">Ведущий цвет состояния задаёт акценты экрана: подсветку карты, рамку карточки и маркер в шапке. Тревога и перехват — коралловый; документирование — нейтральный Пенный: событие закрыто, дальше работа с бумагами.</div>')}
  `, { label: 'Применение', num: '07' });
}

export function p73() {
  const okQ = 'Буй Камышовый-4 услышал мотор. Похоже на тот же катер, что был здесь во вторник. 3,2 км от вас';
  const badQ = 'Alert #4738. Anomaly detected. Confidence: 0.94';
  const rules = [
    ['Говорим как напарник', 'Коротко, по делу, на «вы» без канцелярита. Не робот и не диктор.'],
    ['Сначала что, потом где и сколько', 'Событие, место, расстояние до цели — в таком порядке.'],
    ['Называем по именам', '«Буй Камышовый-4», «протока Старая» — не «sensor_04» и не «zone-B».'],
    ['Цифры — с пояснением', 'Не «confidence 0.94», а «совпадение с катером от 5 мая, 89 %».'],
  ];
  return page('p73', 'light', `
    ${top('7.3', 'Голос системы', 'Не робот, а напарник. Так система говорит с инспектором — в интерфейсе, в Telegram и в отчётах.')}
    <div class="card bgc" style="left:63px;top:205px;width:600px;height:178px">
      <div class="abs" style="left:26px;top:22px;display:flex;align-items:center;gap:9px"><span class="dot" style="background:var(--acc)"></span><span class="cap" style="color:var(--acc)">Так — напарник</span></div>
      <div class="abs" style="left:26px;top:56px;right:36px;font-weight:300;font-size:23px;line-height:31px;letter-spacing:-.01em;color:${C.primary}">«${okQ}»</div>
    </div>
    <div class="card" style="left:63px;top:399px;width:600px;height:128px">
      <div class="abs" style="left:26px;top:22px;display:flex;align-items:center;gap:9px"><span class="dot" style="background:${C.alert}"></span><span class="cap" style="color:var(--bg)">Не так — робот</span></div>
      <div class="abs mono" style="left:26px;top:60px;right:36px;font-size:17px;line-height:26px;color:var(--tx2);text-decoration:line-through;text-decoration-color:rgba(239,68,68,.7)">${badQ}</div>
    </div>
    <div class="card bgc" style="left:63px;top:543px;width:600px;height:205px">
      <div class="abs cap" style="left:26px;top:22px">Слоган</div>
      <div class="abs" style="left:26px;top:54px;font-weight:300;font-size:48px;line-height:54px;letter-spacing:-.02em;color:${C.primary}">404: <span style="color:var(--acc)">Браконьер</span><br>не найден</div>
      <div class="abs t11" style="left:26px;bottom:22px;right:36px;font-size:11px">Код ошибки, который знает каждый. Браконьерство — баг экосистемы, и мы его фиксим.</div>
    </div>
    ${box('left:683px;top:203px', '<span class="cap">Принципы</span>')}
    ${box('left:683px;top:225px;width:424px;border-top:1px solid var(--ln)', rules.map(([t, v], i) => `
      <div style="display:grid;grid-template-columns:36px 1fr;padding:15px 0;border-bottom:1px solid var(--ln)">
        <span style="font-weight:300;font-size:20px;line-height:22px;color:var(--hl)">0${i + 1}</span>
        <div><div style="font-weight:600;font-size:14px">${t}</div><div class="t12" style="font-size:12.5px;line-height:18px;margin-top:4px">${v}</div></div></div>`).join(''))}
    ${box('left:683px;top:600px;width:424px', '<div class="t12" style="font-size:12.5px;line-height:19px">В тревоге — спокойный тон и ясное действие: что произошло и что делать. Шутки и восклицательные знаки — только в режиме спокойствия, и то редко.</div>')}
  `, { label: 'Применение', num: '07' });
}

export function p74() {
  const xs = [63, 418, 772], ys = [205, 484];
  const stroke = 'rgba(226,232,240,.22)';
  const tablet = `<svg width="334" height="190" viewBox="0 0 334 190" style="position:absolute;left:0;top:0">
    <rect x="52" y="22" width="230" height="146" rx="12" fill="${C.surface}" stroke="${stroke}"/>
    <rect x="60" y="30" width="214" height="130" rx="7" fill="${C.bg}"/>
    <g transform="translate(66 36)"><svg width="60" height="14" viewBox="0 0 ${LOCKUP_H.w} ${LOCKUP_H.h}"><path fill="${C.primary}" d="${LOCKUP_H.d}"/></svg></g>
    <g transform="translate(60 52) scale(.54 .54)">${[[40, 40], [110, 30], [200, 60], [70, 110], [170, 120], [250, 100], [150, 190]].map(([x, y], i) => nodeSVG(x + 10, y + 10, 8, i === 4 ? C.alert : C.accent)).join('')}<path fill="none" d="M50,50 L120,40 L210,70 M80,120 L180,130 L260,110 M120,40 L80,120 M210,70 L180,130" stroke="${C.accent}" stroke-opacity=".3" stroke-width="1.5"/></g>
  </svg>`;
  const tg = `<svg width="334" height="190" viewBox="0 0 334 190" style="position:absolute;left:0;top:0">
    <circle cx="86" cy="95" r="44" fill="${C.bg}" stroke="${stroke}"/>
    ${markAt(86, 95, 50, C.primary)}
    <rect x="148" y="52" width="164" height="86" rx="14" fill="${C.surface}" stroke="${stroke}"/>
    <text x="162" y="74" font-family="Inter" font-weight="600" font-size="10.5" fill="${C.accent}">404</text>
    <text x="162" y="92" font-family="Inter" font-size="10.5" fill="${C.primary}">Буй Камышовый-4</text>
    <text x="162" y="106" font-family="Inter" font-size="10.5" fill="${C.primary}">услышал мотор.</text>
    <text x="162" y="124" font-family="JetBrains Mono" font-size="9" fill="${T_DARK}">3.2 км от вас</text></svg>`;
  const buoy = `<svg width="334" height="190" viewBox="0 0 334 190" style="position:absolute;left:0;top:0">
    <path d="M30,152 C60,144 90,160 120,152 S180,144 210,152 S270,160 304,150" fill="none" stroke="${C.accent}" stroke-opacity=".45" stroke-width="1.5"/>
    <path d="M30,166 C60,158 90,174 120,166 S180,158 210,166 S270,174 304,164" fill="none" stroke="${C.accent}" stroke-opacity=".22" stroke-width="1.5"/>
    <rect x="132" y="56" width="70" height="108" rx="14" fill="${C.surface}" stroke="${stroke}"/>
    <path d="M132,92 H202 M132,140 H202" stroke="${C.bg}" stroke-width="6"/>
    <path d="M167,56 V30" stroke="${stroke}" stroke-width="3"/>${nodeSVG(167, 22, 9, C.accent)}
    ${markAt(167, 118, 40, C.grey)}</svg>`;
  const patch = `<svg width="334" height="190" viewBox="0 0 334 190" style="position:absolute;left:0;top:0">
    <circle cx="167" cy="95" r="70" fill="${C.bg}" stroke="${C.grey}" stroke-width="2"/><circle cx="167" cy="95" r="62" fill="none" stroke="${C.grey}" stroke-width="1.4" stroke-dasharray="3 3"/>
    ${markAt(167, 95, 84, C.grey)}</svg>`;
  const slide = `<svg width="334" height="190" viewBox="0 0 334 190" style="position:absolute;left:0;top:0">
    <rect x="54" y="30" width="226" height="127" rx="6" fill="${C.bg}" stroke="${stroke}"/>
    <g transform="translate(66 42)"><svg width="46" height="11" viewBox="0 0 ${LOCKUP_H.w} ${LOCKUP_H.h}"><path fill="${C.primary}" d="${LOCKUP_H.d}"/></svg></g>
    <text x="66" y="104" font-family="Inter" font-weight="300" font-size="19" fill="${C.primary}" letter-spacing="-.4">404: <tspan fill="${C.accent}">Браконьер</tspan></text>
    <text x="66" y="126" font-family="Inter" font-weight="300" font-size="19" fill="${C.primary}" letter-spacing="-.4">не найден</text>
    <path d="M66,140 H110" stroke="${C.accent}" stroke-width="2"/></svg>`;
  const badge = `<svg width="334" height="190" viewBox="0 0 334 190" style="position:absolute;left:0;top:0">
    <rect x="158" y="8" width="18" height="14" rx="3" fill="${C.grey}"/>
    <rect x="117" y="20" width="100" height="152" rx="10" fill="${C.bg}" stroke="${stroke}"/>
    <rect x="117" y="154" width="100" height="18" rx="0" fill="${C.accent}"/><rect x="117" y="154" width="100" height="18" fill="${C.accent}" clip-path="inset(0 round 0 0 10px 10px)"/>
    ${markAt(167, 62, 50, C.primary)}
    <path d="M137,104 H197 M137,116 H180" stroke="${C.primary}" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    <text x="137" y="144" font-family="Inter" font-weight="600" font-size="8" letter-spacing="1.2" fill="${T_DARK}">ИНСПЕКТОР</text></svg>`;
  const items = [
    ['Планшет инспектора', 'PWA в тёмной теме: Background, Surface, Accent', tablet],
    ['Telegram-бот', 'Аватар: знак Primary на Background, 1080 px', tg],
    ['Корпус буя', 'Лазерная гравировка знака, Grey на Background', buoy],
    ['Нашивка', 'Вышивка тон-в-тон: Grey на Background', patch],
    ['Слайд презентации', 'Background, заголовок Inter Light, акцент Accent', slide],
    ['Бейдж инспектора', 'Знак Primary на Background, полоса Accent', badge],
  ];
  return page('p74', 'dark', `
    ${top('7.4', 'Носители и мерч', 'На тёмных изделиях — знак Primary; на металле и ткани — без краски, тоном. Изображения схематичны: способ нанесения согласуйте с производством.')}
    ${items.map(([t, s, art], i) => `<div class="card bgc" style="left:${xs[i % 3]}px;top:${ys[Math.floor(i / 3)]}px;width:334px;height:258px">${art}
      <div class="abs" style="left:22px;bottom:18px"><div style="font-weight:600;font-size:14px">${t}</div><div class="t11" style="margin-top:3px">${s}</div></div></div>`).join('')}
  `, { label: 'Применение', num: '07' });
}

// ===== РАЗДЕЛ 08 =====
export const d08 = () => divider('d08', '08', 'Файлы', 'Пакет логотипов, форматы и токены для кода', [
  ['8.1', 'Состав пакета', 'p81'], ['8.2', 'Форматы файлов', 'p82'], ['8.3', 'Токены для кода', 'p83']]);

export function p81(pkg) {
  const list = pkg.groups.map(g => `<div style="display:grid;grid-template-columns:200px 40px 1fr;align-items:center;min-height:44px;padding:4px 0;border-bottom:1px solid var(--ln)">
    <div style="font-weight:600;font-size:12.5px;padding-left:16px">${g.dir}</div><div style="font-size:12px;color:var(--tx2);text-align:right;padding-right:14px;font-variant-numeric:tabular-nums">${g.count}</div><div class="t11" style="font-size:11.5px;line-height:16px">${g.desc}</div></div>`).join('');
  const el = [['logo', 'знак'], ['lockup-horizontal', 'горизонтальный логотип'], ['lockup-stacked', 'вертикальный логотип'], ['wordmark', 'надпись']];
  const col = [['cream', `Primary ${C.primary} — для тёмных фонов`], ['dark', `Background ${C.bg} — для светлых фонов`], ['black', '#000000 — одноцветная печать, гравировка'], ['white', '#FFFFFF — тиснение, плёнки, одноцветная печать']];
  const r = (arr) => rows(arr, { cols: '' }).replace(/class="tr "/g, 'class="tr" style="grid-template-columns:150px 1fr;min-height:34px;font-size:12px"');
  return page('p81', 'light', `
    ${top('8.1', 'Состав пакета', 'Пакет логотипов лежит в репозитории рядом с этим документом: brand/logo-package/. Имена файлов описывают элемент, цвет и размер.')}
    ${box('left:63px;top:204px', '<span class="cap">Состав пакета · число файлов</span>')}
    ${box('left:63px;top:226px;width:600px;border-top:1px solid var(--ln)', `
      <div style="display:grid;grid-template-columns:200px 40px 1fr;align-items:center;min-height:44px;border-bottom:1px solid var(--ln)"><div style="font-weight:600;font-size:14px">404-logo-package/</div><div style="font-size:12px;text-align:right;padding-right:14px;color:var(--tx2)">${pkg.total}</div><div class="t11" style="font-size:11.5px">Папка пакета; рядом — архив 404-logo-package.zip</div></div>
      <div style="display:grid;grid-template-columns:200px 40px 1fr;align-items:center;min-height:36px;border-bottom:1px solid var(--ln)"><div style="font-weight:600;font-size:12.5px;padding-left:16px">README.txt</div><div style="font-size:12px;text-align:right;padding-right:14px;color:var(--tx2)">1</div><div class="t11" style="font-size:11.5px">Описание пакета</div></div>
      ${list}`)}
    ${box('left:683px;top:204px', '<span class="cap">Имена файлов</span>')}
    ${box('left:683px;top:228px;font-weight:600;font-size:23px;letter-spacing:-.01em;border-bottom:2px solid var(--acc);padding-bottom:2px', '404-элемент-цвет.svg')}
    ${box('left:683px;top:272px;width:424px', '<div class="t11" style="font-size:11px">Растр: 404-logo-cream-1024.png, 404-logo-on-accent.png</div>')}
    ${box('left:683px;top:312px', '<span class="cap">Элемент</span>')}
    ${box('left:683px;top:334px;width:424px', r(el))}
    ${box('left:683px;top:492px', '<span class="cap">Цвет</span>')}
    ${box('left:683px;top:514px;width:424px', r(col))}
  `, { label: 'Файлы', num: '08' });
}

export function p82(pkg) {
  const xs = [63, 329, 595, 860];
  const cards = [
    ['SVG', 'Веб и масштабируемая графика', 'Вектор: масштабируется без потерь. Сайты, интерфейсы, исходники для макетов.', 'svg/', `${pkg.byDir['svg/']} файлов · cream, dark, black, white`],
    ['PDF', 'Типография и макеты', 'Вектор для печати и вёрстки: передавайте в типографию и вставляйте в макеты.', 'pdf/', `${pkg.byDir['pdf/']} файлов · dark, black, cream на Background`],
    ['PNG', 'Офис, презентации, соцсети', 'Растр с прозрачным или фирменным фоном. Не увеличивайте выше исходного размера.', 'png/', '512–2400 px · аватары, обложка, иконки'],
    ['ICO / SVG', 'Фавикон — сайт', 'Знак для вкладки браузера, закладок и иконок на домашнем экране.', 'favicon/', 'favicon.ico, favicon.svg, PNG 32–512 px'],
  ];
  const tasks = [
    ['Сайт: шапка, меню', 'svg/404-lockup-horizontal-cream.svg'],
    ['Интерфейс: вкладка, PWA', 'favicon/ — favicon.svg, icon-192.png, icon-512.png'],
    ['Презентации и документы', 'png/lockup-transparent/ — 1200 или 2400 px'],
    ['Аватар: соцсети, Telegram-бот', 'png/social/404-avatar-background.png'],
    ['Превью ссылки', 'png/social/404-og-1200x630.png'],
    ['Гравировка, тиснение, плёнка', 'svg/ или pdf/ — версия black'],
  ];
  return page('p82', 'dark', `
    ${top('8.2', 'Форматы файлов', 'Четыре формата закрывают все задачи — от сайта до типографии.')}
    ${cards.map(([f, t, d, dir, n], i) => `<div class="card" style="left:${xs[i]}px;top:205px;width:246px;height:275px;background:transparent">
      <div class="abs" style="left:22px;top:20px;font-weight:300;font-size:38px;letter-spacing:-.02em">${f}</div>
      <div class="abs" style="left:22px;top:84px;right:22px;font-weight:600;font-size:13.5px;line-height:18px">${t}</div>
      <div class="abs t11" style="left:22px;top:122px;right:22px;font-size:11.5px;line-height:17px">${d}</div>
      <div class="abs" style="left:22px;right:22px;bottom:20px;border-top:1px solid var(--ln);padding-top:11px"><div style="font-weight:600;font-size:11.5px">${dir}</div><div class="t11" style="font-size:10.5px;margin-top:2px;line-height:15px">${n}</div></div></div>`).join('')}
    ${box('left:63px;top:514px', '<span class="cap">Какой файл выбрать</span>')}
    ${box('left:63px;top:540px;width:300px', '<div class="t12" style="font-size:12.5px;line-height:19px">Для любого носителя начинайте с вектора. PNG — только там, где программа не принимает SVG или PDF.</div>')}
    ${box('left:418px;top:514px;width:689px', `<div style="display:grid;grid-template-columns:274px 1fr;height:30px;align-items:center;border-bottom:1px solid var(--ln)" class="cap"><div style="font-size:9px">Задача</div><div style="font-size:9px">Файл</div></div>${tasks.map(([a, b]) => `<div style="display:grid;grid-template-columns:274px 1fr;height:35px;align-items:center;border-bottom:1px solid var(--ln);font-size:12.5px"><div style="font-weight:600">${a}</div><div style="color:var(--tx2)">${b}</div></div>`).join('')}`)}
  `, { label: 'Файлы', num: '08' });
}

export function p83() {
  const code = (txt, fs = 10.5, lh = 16.2) => `<pre class="mono" style="font-size:${fs}px;line-height:${lh}px;color:${C.primary};white-space:pre;margin:0">${esc(txt)
    .replace(/(\/\*.*?\*\/|\/\/.*)|(#[0-9A-Fa-f]{6})/g, (m, c1, c2) => c1 ? `<span style="color:${T_DARK}">${c1}</span>` : `<span style="color:${C.accent}">${c2}</span>`)}</pre>`;
  const cssLines = tokensCss.split('\n');
  const css = cssLines.slice(0, cssLines.findIndex(l => l.startsWith('body'))).join('\n').trimEnd();
  return page('p83', 'dark', `
    ${top('8.3', 'Токены для кода', 'Цвета и шрифты из этого документа — в виде переменных CSS и пресета Tailwind. Лежат в brand/tokens/; менять значения вручную не нужно.')}
    <div class="card" style="left:63px;top:205px;width:600px;height:543px">
      <div class="abs cap" style="left:22px;top:18px">tokens.css</div>
      <div class="abs" style="left:22px;top:44px;right:22px">${code(css)}</div></div>
    <div class="card" style="left:683px;top:205px;width:424px;height:362px">
      <div class="abs cap" style="left:22px;top:18px">tailwind.preset.cjs</div>
      <div class="abs" style="left:22px;top:44px;right:22px">${code(tailwindPreset.split('\n').slice(0, 22).join('\n'), 10, 15.2)}</div></div>
    ${box('left:683px;top:588px;width:424px;border-top:1px solid var(--ln);padding-top:11px', `<div class="cap" style="font-size:9px">Шрифты</div><div class="t12" style="margin-top:9px;font-size:12px;line-height:18px">Inter 300, 400, 500, 600 и JetBrains Mono 400, 500 — с кириллицей. Подключайте через Google Fonts или пакеты @fontsource/inter и @fontsource/jetbrains-mono.</div>`)}
    ${box('left:683px;top:676px;width:424px;border-top:1px solid var(--ln);padding-top:11px', `<div class="cap" style="font-size:9px">Правило</div><div class="t12" style="margin-top:9px;font-size:12px;line-height:18px">В компонентах — только переменные и классы из токенов. Новые цвета в разметку не добавляем: сначала в этот документ.</div>`)}
  `, { label: 'Файлы', num: '08' });
}

// ===== ФИНАЛ =====
export function end() {
  return `<section class="page dark" id="end">
    <div class="abs" style="inset:0;background:radial-gradient(ellipse 50% 45% at 50% 46%, rgba(45,212,191,.06), rgba(45,212,191,0) 70%)"></div>
    <div class="abs ctr" style="left:0;right:0;top:300px">${M(C.primary, 'height:170px;width:auto')}</div>
    <div class="abs cap" style="left:0;right:0;top:757px;text-align:center">404 · Бренд-гайд · Версия 2.0 · 2026</div>
  </section>`;
}
