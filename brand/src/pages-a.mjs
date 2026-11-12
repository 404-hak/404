// 404 · страницы: обложка → раздел 03 «Цвет»
import * as G from './geometry.mjs';
import { C, MM, pn, page, top, box, rows, divider, ftr, T_DARK, T_LIGHT, fx, ratio } from './ui.mjs';

const { MARK, WORD, LOCKUP_H, LOCKUP_V } = G;
const M = (fill, style) => G.inlineMark(fill, style);
const LH = (fill, style) => G.inlineLockup('horizontal', fill, style);
const LV = (fill, style) => G.inlineLockup('stacked', fill, style);
const P = MARK.pct;
const ratioMark = fx((MARK.h / MARK.w).toFixed(2));
const ratioH = fx((LOCKUP_H.w / LOCKUP_H.h).toFixed(2));
const ratioV = fx((LOCKUP_V.w / LOCKUP_V.h).toFixed(2));
const pct0 = v => Math.round(v);

export const SECTIONS = [
  ['01', 'Логотип', 'Знак, версии логотипа и их назначение', 'd01'],
  ['02', 'Построение', 'Конструкция знака, композиция, охранное поле и минимальный размер', 'd02'],
  ['03', 'Цвет', 'Палитра, статусные цвета, пропорции и допустимые сочетания', 'd03'],
  ['04', 'Типографика', 'Шрифты Inter и JetBrains Mono, шкала размеров и правила набора', 'd04'],
  ['05', 'Логотип на фонах', 'Знак на фирменных цветах, иконки и фавикон', 'd05'],
  ['06', 'Недопустимое использование', 'Чего нельзя делать со знаком', 'd06'],
  ['07', 'Применение', 'Интерфейс, состояния, голос системы, носители и мерч', 'd07'],
  ['08', 'Файлы', 'Пакет логотипов, форматы и токены для кода', 'd08'],
];

// ---------- размерные линии ----------
const tick = (x, y, c) => `<path d="M${x - 3.5},${y + 3.5} L${x + 3.5},${y - 3.5}" stroke="${c}" stroke-width="1"/>`;
function dimV(x, y1, y2, label, c, { side = 'left', rot = true, off = 9 } = {}) {
  const lx = side === 'left' ? x - off : x + off;
  const ly = (y1 + y2) / 2;
  const t = rot
    ? `<text transform="translate(${lx} ${ly}) rotate(-90)" text-anchor="middle" font-size="10.5" font-weight="600" fill="${c}">${label}</text>`
    : `<text x="${lx}" y="${ly + 3.5}" text-anchor="${side === 'left' ? 'end' : 'start'}" font-size="10.5" font-weight="600" fill="${c}">${label}</text>`;
  return `<path d="M${x},${y1} L${x},${y2}" stroke="${c}" stroke-width="1"/>${tick(x, y1, c)}${tick(x, y2, c)}${t}`;
}
function dimH(y, x1, x2, label, c, { above = true, off = 7 } = {}) {
  const ly = above ? y - off : y + off + 8;
  return `<path d="M${x1},${y} L${x2},${y}" stroke="${c}" stroke-width="1"/>${tick(x1, y, c)}${tick(x2, y, c)}` +
    `<text x="${(x1 + x2) / 2}" y="${ly}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${c}">${label}</text>`;
}

// ===== ОБЛОЖКА =====
export function cover() {
  return `<section class="page dark" id="cover">
  <div class="abs" style="inset:0;background:radial-gradient(ellipse 62% 50% at 50% 42%, rgba(45,212,191,.085), rgba(45,212,191,0) 70%),radial-gradient(ellipse 85% 70% at 50% 42%, ${C.surface}, ${C.bg} 72%)"></div>
  ${box('left:0;right:0;top:236px', `<div style="display:flex;justify-content:center">${LV(C.primary, 'width:258px;height:auto')}</div>`)}
  ${box('left:63px;right:63px;top:710px;height:1px;background:var(--ln)')}
  ${box('left:63px;top:728px;font-weight:300;font-size:34px;letter-spacing:-.01em', 'Бренд-гайд')}
  ${box('right:63px;top:757px', '<span class="cap">Эко-щит Каспия · Версия 2.0 · 2026</span>')}
  </section>`;
}

// ===== СОДЕРЖАНИЕ =====
export function toc() {
  const list = SECTIONS.map(([n, t, d, id], i) => `
    <div style="display:grid;grid-template-columns:88px 1fr auto;align-items:center;height:72.4px;border-bottom:1px solid var(--ln)">
      <div style="font-weight:300;font-size:23px;color:var(--hl)">${n}</div>
      <div><div style="font-weight:600;font-size:17px;line-height:22px">${t}</div><div class="t11" style="font-size:12px;margin-top:2px">${d}</div></div>
      <div style="font-weight:600;font-size:13px;font-variant-numeric:tabular-nums">${pn(id)}</div>
    </div>`).join('');
  return page('toc', 'dark', `
    ${box('left:63px;top:93px', '<span class="cap">404 · Бренд-гайд</span>')}
    ${box('left:63px;top:112px;font-weight:300;font-size:48px;line-height:56px;letter-spacing:-.015em', 'Содержание')}
    ${box('left:418px;right:63px;top:102px;border-top:1px solid var(--ln)', list)}
  `, { label: 'Содержание' });
}

// ===== ВВЕДЕНИЕ =====
export function intro() {
  const steps = [
    ['01', 'Берите готовые файлы', 'Знак и надпись 404 — отрисованные элементы: не перерисовывайте их и не набирайте шрифтом. Файлы — в пакете логотипов, раздел 08.'],
    ['02', 'Выберите версию', 'Знак, горизонтальный или вертикальный логотип — по формату носителя, раздел 01.'],
    ['03', 'Проверьте размер и поля', 'Охранное поле и минимальный размер описаны в разделе 02.'],
    ['04', 'Задайте цвета по таблице', 'HEX и RGB — для экрана и кода, CMYK — ориентир для печати, раздел 03. Токены — раздел 08.'],
    ['05', 'Наберите текст шрифтами бренда', 'Inter — текст, JetBrains Mono — данные; шкала — раздел 04. В офисных документах — Arial.'],
    ['06', 'Сверьтесь со списком ошибок', 'Раздел 06 — перед передачей макета в работу.'],
  ];
  const cell = ([n, t, d], i) => {
    const x = 63 + (i % 3) * 354.5, y = i < 3 ? 469 : 626;
    return box(`left:${x}px;top:${y}px;width:334px;border-top:1px solid var(--ln);padding-top:10px`,
      `<div style="font-weight:300;font-size:30px;line-height:36px;color:var(--hl)">${n}</div>
       <div style="font-weight:600;font-size:14px;margin-top:9px">${t}</div>
       <div class="t12" style="font-size:12px;line-height:18px;margin-top:5px;width:300px">${d}</div>`);
  };
  return page('intro', 'light', `
    ${box('left:63px;top:96px', '<span class="cap">Введение</span>')}
    ${box('left:63px;top:123px;width:700px;font-weight:300;font-size:41px;line-height:49px;letter-spacing:-.012em',
      'Правила использования знака, цвета и шрифта 404. Документ для команды, дизайнеров и разработчиков.')}
    ${box('left:772px;top:95px;width:334px;border-top:1px solid var(--ln);padding-top:10px',
      `<div class="cap" style="font-size:9px">Что в документе</div>
       <div class="t12" style="margin-top:10px;font-size:12.5px">Логотип и его версии, построение знака, охранное поле и минимальные размеры, цвета с HEX и RGB, статусные цвета, шрифты и шкала набора, логотип на фонах, недопустимое использование, примеры в интерфейсе и на носителях, состав пакета файлов и токены для кода.</div>`)}
    ${box('left:772px;top:262px;width:334px;border-top:1px solid var(--ln);padding-top:10px',
      `<div class="cap" style="font-size:9px">Версия документа</div>
       <div class="t12" style="margin-top:10px;font-size:12.5px">Версия 2.0 · 2026. Значения цветов, размеров и пропорций в документе — единый источник для всех макетов, файлов и кода.</div>`)}
    ${box('left:63px;top:436px', '<span class="cap">Как пользоваться</span>')}
    ${steps.map(cell).join('')}
  `, { label: 'Введение' });
}

// ===== РАЗДЕЛ 01 =====
export const d01 = () => divider('d01', '01', 'Логотип', 'Знак, версии логотипа и их назначение', [
  ['1.1', 'Основная версия', 'p11'], ['1.2', 'Версии логотипа', 'p12'], ['1.3', 'Инверсная версия', 'p13']]);

export function p11() {
  const L = 'left:683px;width:424px;';
  return page('p11', 'dark', `
    ${top('1.1', 'Основная версия', 'Знак — «нерв-щит»: щит из двух лезвий-волн, внутри ветвится нерв с узлами-буями. Вместе с надписью 404 образует логотип.')}
    <div class="card" style="left:63px;top:205px;width:600px;height:543px">
      <div class="abs ctr" style="inset:0 0 20px 0">${M(C.primary, 'height:352px;width:auto')}</div>
      <div class="abs cap" style="left:20px;bottom:20px">Primary ${C.primary} на Background ${C.bg}</div>
    </div>
    ${box(L + 'top:203px', '<span class="cap">Параметры</span>')}
    ${box(L + 'top:225px', rows([
      ['Тип', 'Комбинированный: знак + надпись'],
      ['Форма знака', 'Щит и нерв с тремя узлами'],
      ['Надпись', '404, широкие отрисованные цифры'],
      ['Цвет', `Primary ${C.primary} на Background ${C.bg}`],
      ['Минимальный размер знака', '8 мм / 16 px'],
      ['Охранное поле', '½ высоты знака'],
    ]))}
    ${box(L + 'top:512px', '<span class="cap">Состав логотипа</span>')}
    ${box(L + 'top:542px', `
      <div style="display:grid;grid-template-columns:52px 196px;column-gap:18px;align-items:center">
        <div>${M(C.primary, 'width:52px;height:auto')}</div>
        <div>${G.inlineWord(C.primary, 'width:196px;height:auto')}</div>
        <div style="margin-top:12px;border:1px solid var(--tx2);border-top:0;height:5px;opacity:.7"></div>
        <div style="margin-top:12px;border:1px solid var(--tx2);border-top:0;height:5px;opacity:.7"></div>
        <div class="t11" style="margin-top:7px;font-weight:600;color:var(--primary);font-size:11px">Знак</div>
        <div class="t11" style="margin-top:7px;font-weight:600;color:var(--primary);font-size:11px">Надпись 404</div>
      </div>`)}
    ${box(L + 'top:672px', '<div class="t12" style="font-size:12.5px;line-height:19px">Основная версия — светлый знак Primary на тёмном Background. Это ночной режим бренда — он же режим интерфейса инспектора. Используйте её везде, где нет причин для другой версии. Знак не растягивается и не поворачивается; пропорции — в разделе 02.</div>')}
  `, { label: 'Логотип', num: '01' });
}

export function p12() {
  const xs = [63, 418, 772];
  const files = ['404-logo-cream.svg · 404-logo-dark.svg', '404-lockup-horizontal-cream.svg · …-dark.svg', '404-lockup-stacked-cream.svg · …-dark.svg'];
  const desc = [
    'Аватары, иконки приложений, фавикон, тиснение, малые носители и места, где имя бренда уже присутствует.',
    'Основная версия с надписью: шапки сайта и документов, вывески, широкие форматы.',
    'Упаковка, обложки, квадратные и вертикальные форматы.',
  ];
  const titles = ['Знак', 'Горизонтальный логотип', 'Вертикальный логотип'];
  const art = (k, fill) => k === 0 ? M(fill, 'height:104px;width:auto') : k === 1 ? LH(fill, 'width:232px;height:auto') : LV(fill, 'width:132px;height:auto');
  const cells = xs.map((x, k) => `
    ${box(`left:${x}px;top:206px;font-weight:600;font-size:14.5px`, titles[k])}
    <div class="card bgc ctr" style="left:${x}px;top:237px;width:334px;height:188px">${art(k, C.primary)}<div class="abs cap" style="left:20px;bottom:17px">Основная</div></div>
    <div class="card pc ctr" style="left:${x}px;top:441px;width:334px;height:189px">${art(k, C.bg)}<div class="abs cap" style="left:20px;bottom:17px;color:${T_LIGHT}">Инверсная</div></div>
    ${box(`left:${x}px;top:648px;width:300px`, `<div class="t12" style="font-size:12.5px;line-height:19px">${desc[k]}</div>`)}
    ${box(`left:${x}px;top:712px;width:334px`, `<div class="t11" style="font-size:11px">${files[k]}</div>`)}`).join('');
  return page('p12', 'dark', `
    ${top('1.2', 'Версии логотипа', 'Три версии логотипа. Каждая существует в основном цвете — Primary на Background — и в инверсном — Background на Primary.')}
    ${cells}
  `, { label: 'Логотип', num: '01' });
}

export function p13() {
  const L = 'left:683px;width:424px;';
  const c = G.contrast(C.primary, C.bg);
  return page('p13', 'light', `
    ${top('1.3', 'Инверсная версия', 'Инверсная версия — тёмный знак Background на светлом Primary. Для светлых носителей: документы, бланки, инверсные визитки.')}
    <div class="card" style="left:63px;top:205px;width:600px;height:543px">
      <div class="abs ctr" style="inset:0 0 20px 0">${M(C.bg, 'height:352px;width:auto')}</div>
      <div class="abs cap" style="left:20px;bottom:20px">Background ${C.bg} на Primary ${C.primary}</div>
    </div>
    ${box(L + 'top:203px', '<span class="cap">Параметры</span>')}
    ${box(L + 'top:225px', rows([
      ['Знак', `Background ${C.bg}`],
      ['Фон', `Primary ${C.primary}`],
      ['Контраст', `${fx(c.toFixed(1))}:1 · ${G.wcag(c)}`],
      ['Применение', 'Инверсные носители, документы'],
    ]))}
    <div class="card bgc ctr" style="left:683px;top:415px;width:424px;height:124px">${LH(C.primary, 'width:216px;height:auto')}<div class="abs cap" style="left:20px;bottom:15px">Основная</div></div>
    <div class="card ctr" style="left:683px;top:557px;width:424px;height:124px;background:rgba(255,255,255,.4)">${LH(C.bg, 'width:216px;height:auto')}<div class="abs cap" style="left:20px;bottom:15px">Инверсная</div></div>
    ${box(L + 'top:702px', '<div class="t12" style="font-size:12.5px;line-height:19px">Обе версии логотипа равноправны по форме: меняется только цвет. Другие сочетания цветов — в разделе 05.</div>')}
  `, { label: 'Логотип', num: '01' });
}

// ===== РАЗДЕЛ 02 =====
export const d02 = () => divider('d02', '02', 'Построение', 'Конструкция знака, композиция, охранное поле и минимальный размер', [
  ['2.1', 'Конструкция знака', 'p21'], ['2.2', 'Композиция логотипа', 'p22'], ['2.3', 'Охранное поле', 'p23'], ['2.4', 'Минимальный размер', 'p24']]);

export function p21() {
  const H = 408, s = H / MARK.h, W = MARK.w * s, mx = 118, my = 62;
  const g = 'rgba(11,22,40,.42)', bg = C.bg, dim = C.bg;
  const Y = p => my + p / 100 * H;
  const guides = [
    [0, pct0(0), 'вершина узла'],
    [P.topNodeBottom, pct0(P.topNodeBottom), 'нижний край узла'],
    [P.bladeTop, pct0(P.bladeTop), 'верхние концы щита'],
    [P.sideNodeCenter, pct0(P.sideNodeCenter), 'центры боковых узлов'],
    [P.nerveBase, pct0(P.nerveBase), 'основания ветвей'],
    [P.bladeBottom, pct0(P.bladeBottom), 'нижние концы щита'],
    [100, 100, 'нижний конец стебля'],
  ];
  let prev = -99;
  const lab = guides.map(([p, v, t]) => { const y = Y(p); const ly = Math.max(y, prev + 31); prev = ly; return { y, ly, v, t }; });
  const lines = lab.map(l => `<path d="M${mx - 34},${l.y} H470" stroke="${g}" stroke-width=".9"/>` +
    `<path d="M470,${l.y} H480 L490,${l.ly}" fill="none" stroke="${g}" stroke-width=".9"/>` +
    `<text x="496" y="${l.ly + 3}" font-size="11" font-weight="600" fill="${bg}">${l.v} %</text>` +
    `<text x="496" y="${l.ly + 16}" font-size="10" fill="${T_LIGHT}">${l.t}</text>`).join('');
  const cx = mx + W / 2;
  const ringW = P.topNodeW / 100 * W;
  const svg = `<svg width="660" height="543" viewBox="0 0 660 543" style="position:absolute;left:63px;top:205px;font-family:Inter">
    <path d="M${mx},${my - 16} V${my + H + 16}" stroke="${g}" stroke-width=".9"/>
    <path d="M${mx + W},${my - 16} V${my + H + 16}" stroke="${g}" stroke-width=".9"/>
    <path d="M${cx},${my - 24} V${my + H + 24}" stroke="${C.grey}" stroke-width=".9" stroke-dasharray="6 4 1.5 4"/>
    ${lines}
    <g transform="translate(${mx} ${my}) scale(${s})"><path fill="${C.bg}" d="${MARK.d}"/></g>
    ${dimV(mx - 50, my, my + H, 'H = ' + ratioMark + ' W', dim, { rot: true, off: 10 })}
    ${dimH(my + H + 34, mx, mx + W, 'W', dim, { above: false })}
    ${dimH(my - 26, cx - ringW / 2, cx + ringW / 2, pct0(P.topNodeW) + ' % W', dim)}
  </svg>`;
  return page('p21', 'light', `
    ${top('2.1', 'Конструкция знака', 'Направляющие сняты с мастер-файла знака. Знак не перестраивается вручную — используйте файлы из пакета.')}
    ${svg}
    ${box('left:683px;top:203px', '<span class="cap">Пропорции · W — ширина, H — высота знака</span>')}
    ${box('left:683px;top:225px;width:424px', rows([
      ['Высота : ширина', `${ratioMark} : 1`],
      ['Узел сверху', `${pct0(P.topNodeW)} % W`],
      ['Боковые узлы', `${pct0(P.sideNodeW)} % W`],
      ['Стебель сверху', `${pct0(P.stemTopW)} % W`],
      ['Верхние концы щита', `${pct0(P.bladeTop)} % H от верха`],
      ['Основания ветвей', `${pct0(P.nerveBase)} % H от верха`],
      ['Нижние концы щита', `${pct0(P.bladeBottom)} % H от верха`],
    ], { cols: 'c2' }))}
    ${box('left:683px;top:517px;display:flex;gap:26px;font-size:11px;color:' + T_LIGHT, `
      <span style="display:flex;align-items:center;gap:8px"><svg width="34" height="2"><path d="M0,1H34" stroke="${g}" stroke-width="1.2"/></svg>Направляющие</span>
      <span style="display:flex;align-items:center;gap:8px"><svg width="34" height="2"><path d="M0,1H34" stroke="${C.grey}" stroke-width="1.2" stroke-dasharray="6 4 1.5 4"/></svg>Ось симметрии</span>
      <span style="display:flex;align-items:center;gap:8px"><svg width="34" height="2"><path d="M0,1H34" stroke="${C.bg}" stroke-width="1.2"/></svg>Размеры</span>`)}
    ${box('left:683px;top:652px;width:424px', '<div class="t12" style="font-size:12.5px;line-height:19px">Знак — щит из двух лезвий-волн; внутри него ветвится нерв с узлами-буями. Три узла — кольцо с точкой — это тот же глиф, что нуль в надписи 404. Знак симметричен, пропорции неизменны при любом масштабе.</div>')}
  `, { label: 'Построение', num: '02' });
}

export function p22() {
  const dc = C.bg, g = 'rgba(11,22,40,.42)', band = 'rgba(45,212,191,.30)';
  // горизонтальный
  const sH = 0.80, lwH = LOCKUP_H.w * sH, lhH = LOCKUP_H.h * sH;
  const oxH = (600 - lwH) / 2 + 10, oyH = (330 - lhH) / 2;
  const dTop = oyH + (LOCKUP_H.hm - LOCKUP_H.X) / 2 * sH, dBot = dTop + LOCKUP_H.X * sH;
  const bx1 = oxH + LOCKUP_H.wm * sH, bx2 = bx1 + LOCKUP_H.gap * sH;
  const svgH = `<svg width="600" height="330" viewBox="0 0 600 330" style="position:absolute;left:0;top:0;font-family:Inter">
    <rect x="${bx1}" y="${oyH - 16}" width="${bx2 - bx1}" height="${lhH + 32}" fill="${band}"/>
    <path d="M${oxH - 34},${oyH} H${oxH + lwH + 34} M${oxH - 34},${oyH + lhH} H${oxH + lwH + 34}" stroke="${g}" stroke-width=".9"/>
    <path d="M${oxH + LOCKUP_H.wm * sH + LOCKUP_H.gap * sH - 4},${dTop} H${oxH + lwH + 34} M${oxH + LOCKUP_H.wm * sH + LOCKUP_H.gap * sH - 4},${dBot} H${oxH + lwH + 34}" stroke="${g}" stroke-width=".9" stroke-dasharray="4 3"/>
    <g transform="translate(${oxH} ${oyH}) scale(${sH})"><path fill="${C.bg}" d="${LOCKUP_H.d}"/></g>
    ${dimV(oxH - 24, oyH, oyH + lhH, '4/3 X', dc, { off: 9 })}
    ${dimV(oxH + lwH + 26, dTop, dBot, 'X', dc, { rot: false, side: 'right', off: 9 })}
    ${dimH(oyH - 24, bx1, bx2, '½ X', dc)}
  </svg>`;
  // вертикальный
  const sV = 0.70, lwV = LOCKUP_V.w * sV, lhV = LOCKUP_V.h * sV;
  const oxV = (424 - lwV) / 2 + 14, oyV = (330 - lhV) / 2;
  const mY2 = oyV + 200 * sV, dY1 = oyV + 250 * sV, dY2 = oyV + 350 * sV;
  const svgV = `<svg width="424" height="330" viewBox="0 0 424 330" style="position:absolute;left:0;top:0;font-family:Inter">
    <rect x="${oxV}" y="${mY2}" width="${lwV}" height="${dY1 - mY2}" fill="${band}"/>
    <path d="M${oxV - 30},${oyV} H${oxV + lwV + 12} M${oxV - 30},${mY2} H${oxV + lwV + 12} M${oxV - 30},${dY1} H${oxV + lwV + 12} M${oxV - 30},${dY2} H${oxV + lwV + 12}" stroke="${g}" stroke-width=".9"/>
    <path d="M${oxV + lwV / 2},${oyV - 14} V${dY2 + 14}" stroke="${C.grey}" stroke-width=".9" stroke-dasharray="6 4 1.5 4"/>
    <g transform="translate(${oxV} ${oyV}) scale(${sV})"><path fill="${C.bg}" d="${LOCKUP_V.d}"/></g>
    ${dimV(oxV - 22, oyV, mY2, '2 X', dc, { off: 9 })}
    ${dimV(oxV - 22, dY1, dY2, 'X', dc, { off: 9 })}
    <text x="${oxV + lwV + 18}" y="${(mY2 + dY1) / 2 + 3.5}" font-size="10.5" font-weight="600" fill="${dc}">½ X</text>
  </svg>`;
  return page('p22', 'light', `
    ${top('2.2', 'Композиция логотипа', 'X — высота цифр надписи 404. Все размеры логотипа задаются в X; соотношения неизменны при масштабировании.')}
    <div class="card" style="left:63px;top:205px;width:600px;height:330px">${svgH}</div>
    <div class="card" style="left:683px;top:205px;width:424px;height:330px">${svgV}</div>
    ${box('left:63px;top:563px;font-weight:600;font-size:14.5px', 'Горизонтальный логотип')}
    ${box('left:63px;top:593px;width:600px', rows([
      ['Высота знака', '4/3 X (1,33 X)'],
      ['Расстояние знак — надпись', '½ X'],
      ['Положение надписи', 'по центру высоты знака'],
      ['Соотношение сторон', `${ratioH} : 1`],
    ], { cols: 'c2' }))}
    ${box('left:683px;top:563px;font-weight:600;font-size:14.5px', 'Вертикальный логотип')}
    ${box('left:683px;top:593px;width:424px', rows([
      ['Высота знака', '2 X'],
      ['Расстояние знак — надпись', '½ X'],
      ['Ось знака', 'по центру надписи'],
      ['Соотношение сторон', `${ratioV} : 1`],
    ], { cols: 'c2' }))}
  `, { label: 'Построение', num: '02' });
}

export function p23() {
  const T = C.accent, dash = `fill="rgba(45,212,191,.12)" stroke="${T}" stroke-dasharray="4 3" stroke-width="1"`;
  const logoBox = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.bg}" stroke="rgba(226,232,240,.35)" stroke-width=".8"/>`;
  const lbl = (x, y, t, a = 'middle') => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="10" font-weight="600" fill="${C.primary}">${t}</text>`;
  const dl = (x1, y1, x2, y2) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="${C.primary}" stroke-width=".9"/>`;
  // знак
  const hm = 150, wm = MARK.w * hm / MARK.h, c1 = hm / 2, bw1 = wm + 2 * c1, bh1 = hm + 2 * c1, bx1 = (334 - bw1) / 2, by1 = (440 - bh1) / 2;
  const a = `<svg width="334" height="440" style="position:absolute;inset:0;font-family:Inter">
    <rect x="${bx1}" y="${by1}" width="${bw1}" height="${bh1}" ${dash}/>
    ${logoBox(bx1 + c1, by1 + c1, wm, hm)}
    <g transform="translate(${bx1 + c1} ${by1 + c1}) scale(${hm / MARK.h})"><path fill="${C.primary}" d="${MARK.d}"/></g>
    ${dl(bx1 + c1 + wm / 2 + 18, by1, bx1 + c1 + wm / 2 + 18, by1 + c1)}${lbl(bx1 + c1 + wm / 2 + 26, by1 + c1 / 2 + 3, '½ H', 'start')}
    ${dl(bx1, by1 + c1 + hm / 2, bx1 + c1, by1 + c1 + hm / 2)}${lbl(bx1 + c1 / 2, by1 + c1 + hm / 2 - 6, '½ H')}
  </svg>`;
  // горизонтальный
  const sH = 0.42, lw = LOCKUP_H.w * sH, lh = LOCKUP_H.h * sH, c2 = (2 / 3) * LOCKUP_H.X * sH, bw2 = lw + 2 * c2, bh2 = lh + 2 * c2, bx2 = (334 - bw2) / 2, by2 = (440 - bh2) / 2;
  const b = `<svg width="334" height="440" style="position:absolute;inset:0;font-family:Inter">
    <rect x="${bx2}" y="${by2}" width="${bw2}" height="${bh2}" ${dash}/>
    ${logoBox(bx2 + c2, by2 + c2, lw, lh)}
    <g transform="translate(${bx2 + c2} ${by2 + c2}) scale(${sH})"><path fill="${C.primary}" d="${LOCKUP_H.d}"/></g>
    ${dl(bx2 + bw2 - 26, by2, bx2 + bw2 - 26, by2 + c2)}${lbl(bx2 + bw2 - 22, by2 + c2 / 2 + 3, '⅔ X', 'start')}
    ${dl(bx2, by2 + bh2 / 2, bx2 + c2, by2 + bh2 / 2)}${lbl(bx2 + c2 / 2, by2 + bh2 / 2 - 6, '⅔ X')}
  </svg>`;
  // вертикальный
  const sV = 0.44, lwv = LOCKUP_V.w * sV, lhv = LOCKUP_V.h * sV, c3 = LOCKUP_V.X * sV, bw3 = lwv + 2 * c3, bh3 = lhv + 2 * c3, bx3 = (334 - bw3) / 2, by3 = (440 - bh3) / 2;
  const c = `<svg width="334" height="440" style="position:absolute;inset:0;font-family:Inter">
    <rect x="${bx3}" y="${by3}" width="${bw3}" height="${bh3}" ${dash}/>
    ${logoBox(bx3 + c3, by3 + c3, lwv, lhv)}
    <g transform="translate(${bx3 + c3} ${by3 + c3}) scale(${sV})"><path fill="${C.primary}" d="${LOCKUP_V.d}"/></g>
    ${dl(bx3 + bw3 - 22, by3, bx3 + bw3 - 22, by3 + c3)}${lbl(bx3 + bw3 - 18, by3 + c3 / 2 + 3, 'X', 'start')}
    ${dl(bx3, by3 + bh3 / 2, bx3 + c3, by3 + bh3 / 2)}${lbl(bx3 + c3 / 2, by3 + bh3 / 2 - 6, 'X')}
  </svg>`;
  const xs = [63, 418, 772];
  const meta = [['Знак', '½ H', 'H — высота знака'], ['Горизонтальный логотип', '⅔ X', '½ высоты знака: 4/3 X ÷ 2'], ['Вертикальный логотип', 'X', '½ высоты знака: 2 X ÷ 2']];
  return page('p23', 'dark', `
    ${top('2.3', 'Охранное поле', 'Охранное поле — ½ высоты знака в данной версии. Внутрь охранного поля не заходят текст, края носителя и другие графические элементы.')}
    ${[a, b, c].map((svg, i) => `<div class="card" style="left:${xs[i]}px;top:205px;width:334px;height:440px">${svg}</div>`).join('')}
    ${meta.map(([t, v, d], i) => box(`left:${xs[i]}px;top:669px;width:334px`, `<div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-weight:600;font-size:15px">${t}</span><span style="font-weight:600;font-size:15px;color:var(--acc)">${v}</span></div><div class="t11" style="margin-top:5px">${d}</div>`)).join('')}
  `, { label: 'Построение', num: '02' });
}

export function p24() {
  const mkDim = (inner) => `<svg width="334" height="330" style="position:absolute;inset:0;font-family:Inter">${inner}</svg>`;
  const hM = 8 * MM, wH = 35 * MM, wV = 18 * MM;
  const wM = MARK.w * hM / MARK.h;
  const cA = `<div class="abs ctr" style="inset:0">${M(C.bg, `height:${hM}px;width:auto`)}</div>` +
    mkDim(`${dimV(167 + wM / 2 + 14, 165 - hM / 2, 165 + hM / 2, '8 мм', C.bg, { rot: false, side: 'right', off: 8 })}`);
  const lhH = wH / LOCKUP_H.w * LOCKUP_H.h;
  const cB = `<div class="abs ctr" style="inset:0">${LH(C.bg, `width:${wH}px;height:auto`)}</div>` +
    mkDim(dimH(165 + lhH / 2 + 22, 167 - wH / 2, 167 + wH / 2, '35 мм', C.bg, { above: false }));
  const lhV = wV / LOCKUP_V.w * LOCKUP_V.h;
  const cC = `<div class="abs ctr" style="inset:0">${LV(C.bg, `width:${wV}px;height:auto`)}</div>` +
    mkDim(dimH(165 + lhV / 2 + 22, 167 - wV / 2, 167 + wV / 2, '18 мм', C.bg, { above: false }));
  const xs = [63, 418, 772];
  const cards = [cA, cB, cC].map((c, i) => `<div class="card" style="left:${xs[i]}px;top:205px;width:334px;height:330px">${c}<div class="abs cap" style="left:20px;bottom:20px">Масштаб 1:1</div></div>`).join('');
  const names = [['Знак', '8 мм / 16 px по высоте'], ['Горизонтальный логотип', '35 мм / 72 px по ширине'], ['Вертикальный логотип', '18 мм / 64 px по ширине']];
  const notes = [
    ['Мельче — только знак', 'Меньше 16 px используется только знак — например, в фавиконе.'],
    ['Образцы', 'Логотипы на этой странице показаны в натуральную величину при печати в масштабе 100 % на листе A4.'],
    ['Мелкие носители', 'Если логотип не помещается в минимальный размер, используйте знак отдельно.'],
  ];
  return page('p24', 'light', `
    ${top('2.4', 'Минимальный размер', 'Меньше этих размеров детали знака и надписи теряют читаемость в печати и на экране.')}
    ${cards}
    ${names.map(([t, v], i) => box(`left:${xs[i]}px;top:559px;width:334px`, `<div style="font-weight:600;font-size:15px">${t}</div><div style="font-size:13px;margin-top:6px">${v}</div>`)).join('')}
    ${notes.map(([t, v], i) => box(`left:${xs[i]}px;top:678px;width:334px;border-top:1px solid var(--ln);padding-top:11px`, `<div class="cap" style="font-size:9px">${t}</div><div class="t12" style="margin-top:9px;font-size:12.5px">${v}</div>`)).join('')}
  `, { label: 'Построение', num: '02' });
}

// ===== РАЗДЕЛ 03 =====
export const d03 = () => divider('d03', '03', 'Цвет', 'Палитра, статусные цвета, пропорции и допустимые сочетания', [
  ['3.1', 'Палитра', 'p31'], ['3.2', 'Статусные цвета', 'p32'], ['3.3', 'Пропорции и контраст', 'p33']]);

const cm = h => G.cmykOf(h).join(' ');
const rg = h => G.rgbOf(h).join(' ');

export function p31() {
  const sw = [
    { n: 'Пенный', tk: 'Primary', role: 'Основной', hex: C.primary, fg: C.bg, cls: '', d: 'Знак, надпись и основной текст' },
    { n: 'Ночной', tk: 'Background', role: 'Фоновый', hex: C.bg, fg: C.primary, cls: 'bgc', d: 'Основная поверхность бренда и интерфейса' },
    { n: 'Глубинный', tk: 'Surface', role: 'Поверхность', hex: C.surface, fg: C.primary, cls: '', d: 'Карточки, панели и плашки поверх Background' },
    { n: 'Сланцевый', tk: 'Grey', role: 'Дополнительный', hex: C.grey, fg: C.primary, cls: '', d: 'Вторичный текст — крупный; линии, неактивные элементы' },
    { n: 'Бирюзовый', tk: 'Accent', role: 'Акцентный', hex: C.accent, fg: C.bg, cls: '', d: 'Акценты, цифры, маркеры, узлы сети. Он же «Норма»' },
  ];
  const col = (c, i) => {
    const x = 63 + i * 212;
    return `
      <div class="card" style="left:${x}px;top:205px;width:196px;height:228px;background:${c.hex};border-color:${c.cls ? 'var(--line-d)' : 'transparent'}">
        <div class="abs" style="left:18px;bottom:16px;font-weight:600;font-size:21px;letter-spacing:-.01em;color:${c.fg}">${c.n}</div>
      </div>
      ${box(`left:${x}px;top:450px;width:196px;height:34px`, `<div class="t12" style="font-size:11.5px;line-height:17px">${c.d}</div>`)}
      ${box(`left:${x}px;top:494px;width:196px`, rows([
        ['Токен', c.tk], ['Роль', c.role], ['HEX', c.hex], ['RGB', rg(c.hex)], ['CMYK', cm(c.hex)],
      ], { cols: '', style: '' }).replace(/class="tr "/g, 'class="tr" style="grid-template-columns:50px 1fr;min-height:32px;font-size:11.5px"'))}`;
  };
  return page('p31', 'dark', `
    ${top('3.1', 'Палитра', 'Пять цветов бренда. Порядок везде одинаковый: Primary, Background, Surface, Grey, Accent. Статусные цвета — на следующей странице.')}
    ${sw.map(col).join('')}
    ${box('left:63px;top:673px;width:1044px;font-size:11px;line-height:16px;color:var(--tx2)', 'CMYK пересчитан из RGB автоматически и служит ориентиром: точные значения и Pantone подбираются по цветопробе в типографии.')}
  `, { label: 'Цвет', num: '03' });
}

export function p32() {
  const st = [
    { n: 'Норма', tk: 'Status OK', hex: C.accent, d: 'Всё спокойно: буй на связи, зона в порядке, индекс здоровья в норме. Совпадает с Accent.', pulse: 0 },
    { n: 'Предупреждение', tk: 'Status Warn', hex: C.warn, d: 'Настороженность: рискованный сектор, безлунная ночь, прогрев воды, потеря слабого сигнала.', pulse: 1 },
    { n: 'Тревога', tk: 'Status Alert', hex: C.alert, d: 'Тревога: звук мотора или выстрела, пропавший буй, исчезнувшие звуки природы — тишина как улика.', pulse: 2 },
  ];
  const node = (hex, pulse) => {
    const rings = pulse ? [0, 1].map(i => `<circle cx="167" cy="84" r="${34 + (i + 1) * 17}" fill="none" stroke="${hex}" stroke-opacity="${(0.42 - i * 0.2) * (pulse === 2 ? 1 : .8)}" stroke-width="1.5"/>`).join('') : '';
    return `<svg width="334" height="168" viewBox="0 0 334 168" style="position:absolute;left:0;top:0">${rings}
      <circle cx="167" cy="84" r="34" fill="none" stroke="${hex}" stroke-width="11"/><circle cx="167" cy="84" r="11" fill="${hex}"/></svg>`;
  };
  const xs = [63, 418, 772];
  const cards = st.map((s, i) => `
    <div class="card" style="left:${xs[i]}px;top:205px;width:334px;height:408px">
      ${node(s.hex, s.pulse)}
      <div class="abs" style="left:22px;top:178px;right:22px">
        <div style="font-weight:600;font-size:21px;letter-spacing:-.01em">${s.n}</div>
        <div class="t12" style="margin-top:8px;font-size:12px;line-height:18px;height:55px">${s.d}</div>
        <div style="margin-top:12px">${rows([
          ['Токен', s.tk], ['HEX', s.hex], ['RGB', rg(s.hex)],
          ['На Background', `${ratio(s.hex, C.bg)}:1 · ${G.wcag(G.contrast(s.hex, C.bg))}`],
        ], { cols: '' }).replace(/class="tr "/g, 'class="tr" style="grid-template-columns:104px 1fr;min-height:31px;font-size:12px"')}</div>
      </div>
    </div>`).join('');
  const rules = [
    ['Только для состояний', 'Статусные цвета означают событие в системе. Они не используются для знака, логотипа, фона страниц и декора.'],
    ['Один цвет — один смысл', 'Бирюзовый — норма и акцент бренда; янтарный — внимание; коралловый — тревога. Не меняйте их местами.'],
    ['Редкость усиливает сигнал', 'Статусные цвета занимают считанные проценты экрана. Красный на экране — всегда повод действовать.'],
  ];
  return page('p32', 'dark', `
    ${top('3.2', 'Статусные цвета', 'Три цвета говорят за систему: норма, предупреждение, тревога. Это язык интерфейса, не украшение.')}
    ${cards}
    ${rules.map(([t, v], i) => box(`left:${xs[i]}px;top:634px;width:334px;border-top:1px solid var(--ln);padding-top:11px`, `<div style="font-weight:600;font-size:13px">${t}</div><div class="t12" style="margin-top:6px;font-size:12px;line-height:18px">${v}</div>`)).join('')}
  `, { label: 'Цвет', num: '03' });
}

export function p33() {
  const segs = [['Background', C.bg, 55, C.primary], ['Surface', C.surface, 20, C.primary], ['Primary', C.primary, 15, C.bg], ['Grey', C.grey, 5, C.primary], ['Accent', C.accent, 5, C.bg]];
  let acc = 0;
  const bar = segs.map(([n, c, p]) => {
    const w = 1044 * p / 100, x = 63 + 1044 * acc / 100; acc += p;
    return { n, c, p, w, x };
  });
  const barHTML = `<div class="abs" style="left:63px;top:229px;width:1044px;height:58px;border-radius:10px;overflow:hidden;border:1px solid var(--line-l);display:flex">${bar.map(b => `<div style="width:${b.p}%;background:${b.c}"></div>`).join('')}</div>` +
    bar.map(b => box(`left:${b.x + (b.n === 'Background' ? 0 : 0)}px;top:300px`, `<div style="font-weight:600;font-size:16px">${b.p} %</div><div class="t11" style="font-size:10.5px">${b.n}</div>`)).join('');
  const pairs = [
    ['Primary на Background', C.primary, C.bg, 'Знак, заголовки, любой текст'],
    ['Background на Primary', C.bg, C.primary, 'Инверсные носители, документы'],
    ['Accent на Background', C.accent, C.bg, 'Акценты, цифры, маркеры, узлы'],
    ['Background на Accent', C.bg, C.accent, 'Плашки, бейджи, знак на Accent'],
    ['Grey на Background', C.grey, C.bg, 'Только крупный текст, линии, иконки'],
    ['Primary на Grey', C.primary, C.grey, 'Знак и крупный текст на серых плашках'],
    ['Warning на Background', C.warn, C.bg, 'Статус «Предупреждение»'],
    ['Alert на Background', C.alert, C.bg, 'Статус «Тревога»'],
    ['Primary на Surface', C.primary, C.surface, 'Текст на карточках и панелях'],
    ['Accent на Primary', C.accent, C.primary, 'Не сочетать'],
  ];
  const trs = pairs.map(([n, fg, bgc, use]) => {
    const c = G.contrast(fg, bgc);
    const lv = G.wcag(c);
    const border = (bgc === C.primary) ? `border:1px solid var(--line-l);` : '';
    return `<div style="display:grid;grid-template-columns:62px 186px 76px 74px 1fr;align-items:center;height:33px;border-bottom:1px solid var(--ln);font-size:12px">
      <div><span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:22px;border-radius:6px;background:${bgc};color:${fg};font-weight:600;font-size:12px;${border}">Aa</span></div>
      <div style="font-weight:600">${n}</div><div style="font-variant-numeric:tabular-nums">${fx(c.toFixed(1))}:1</div><div>${lv === '—' ? '—' : lv}</div><div style="color:var(--tx2)">${use}</div></div>`;
  }).join('');
  const greyC = G.contrast(C.grey, C.bg), tC = G.contrast(T_DARK, C.bg), accL = G.contrast(C.accent, C.primary);
  const note = (t, v, y) => box(`left:63px;top:${y}px;width:334px;border-top:1px solid var(--ln);padding-top:11px`, `<div class="cap" style="font-size:9px">${t}</div><div class="t12" style="margin-top:9px;font-size:12px;line-height:18px">${v}</div>`);
  return page('p33', 'light', `
    ${top('3.3', 'Пропорции и контраст', 'Контраст — по WCAG 2.x для текста и знака на фоне. Значения рассчитаны по HEX из этой палитры.')}
    ${box('left:63px;top:204px', '<span class="cap">Рекомендуемая доля цвета в макете</span>')}
    ${barHTML}
    ${box('left:63px;top:352px;font-size:0', '')}
    ${note('Сланцевый — только крупно', `Grey ${C.grey} на Background даёт ${fx(greyC.toFixed(1))}:1 — проходит лишь AA Large: текст от 24 px или 18,7 px semibold. Мелкие подписи на тёмном набираем Primary 70 % (${fx(tC.toFixed(1))}:1, AAA).`, 366)}
    ${note('Бирюзовый — только на тёмном', `Accent на Primary — ${fx(accL.toFixed(1))}:1, как текст не читается. На светлых носителях Accent — заливка под текстом Background.`, 494)}
    ${note('Статусные цвета', 'Warning и Alert — по событию, в сумме не более 2 % площади экрана. В пропорции не входят.', 614)}
    ${box('left:418px;top:354px;width:689px', `
      <div style="display:grid;grid-template-columns:62px 186px 76px 74px 1fr;height:28px;align-items:center;border-bottom:1px solid var(--line-l)" class="cap">
        <div style="font-size:9px">Пример</div><div style="font-size:9px">Сочетание</div><div style="font-size:9px">Контраст</div><div style="font-size:9px">Уровень</div><div style="font-size:9px">Применение</div></div>${trs}`)}
  `, { label: 'Цвет', num: '03' });
}
