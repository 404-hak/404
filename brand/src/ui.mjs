// 404 · общий слой брендбука: стили, шапка/подвал, хелперы
import * as G from './geometry.mjs';

export const C = G.COLORS;
export const MM = 1170 / 297; // px на мм: страница 1170 px = A4 landscape 297 мм

export const ORDER = [
  'cover', 'toc', 'intro',
  'd01', 'p11', 'p12', 'p13',
  'd02', 'p21', 'p22', 'p23', 'p24',
  'd03', 'p31', 'p32', 'p33',
  'd04', 'p41', 'p42', 'p43',
  'd05', 'p51', 'p52',
  'd06', 'p61',
  'd07', 'p71', 'p72', 'p73', 'p74',
  'd08', 'p81', 'p82', 'p83',
  'end',
];
export const pn = id => {
  const i = ORDER.indexOf(id);
  if (i < 0) throw new Error('unknown page ' + id);
  return String(i + 1).padStart(2, '0');
};

// производные оттенки (не новые цвета — тоны Primary/Background)
export const T_DARK = G.mix(C.primary, C.bg, 0.70);   // вторичный текст на тёмном
export const T_LIGHT = G.mix(C.bg, C.primary, 0.68);  // вторичный текст на светлом
export const fx = n => String(n).replace('.', ',');
export const ratio = (a, b) => fx(G.contrast(a, b).toFixed(1));

export const css = `
:root{
  --bg:${C.bg};--surface:${C.surface};--primary:${C.primary};--grey:${C.grey};
  --acc:${C.accent};--warn:${C.warn};--alert:${C.alert};
  --t-dark:${T_DARK};--t-light:${T_LIGHT};
  --line-d:rgba(226,232,240,.15);--line-l:rgba(11,22,40,.20);
}
@page{size:297mm 210mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#05080f}
body{font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
svg{display:block}
.page{position:relative;width:1170px;height:827px;overflow:hidden;break-after:page;page-break-after:always}
.dark{background:var(--bg);color:var(--primary);--tx2:var(--t-dark);--ln:var(--line-d);--hs:var(--acc);--hl:var(--acc);--card:var(--surface)}
.light{background:var(--primary);color:var(--bg);--tx2:var(--t-light);--ln:var(--line-l);--hs:var(--t-light);--hl:var(--grey);--card:rgba(255,255,255,.38)}
.light .card.bgc{--tx2:var(--t-dark);--ln:var(--line-d)}
.dark .card.pc,.dark .card.pcb{--tx2:var(--t-light);--ln:var(--line-l)}
.abs{position:absolute}
.hdr{position:absolute;left:63px;right:63px;top:37px;height:20px;display:flex;align-items:center;justify-content:space-between}
.hdr svg{height:14px;width:auto}
.sec{font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--tx2)}
.sec i{font-style:normal;margin-right:9px;color:var(--hs)}
.dark .sec i{color:var(--acc)}
.light .sec i{color:var(--bg)}
.ftr{position:absolute;left:63px;right:63px;bottom:38px;display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.04em;color:var(--tx2)}
.ftr b{font-weight:600;color:inherit;color:var(--bg)}
.dark .ftr b{color:var(--primary)}
.k{position:absolute;left:63px;top:117px;font-size:10px;font-weight:600;letter-spacing:.16em;color:var(--hs)}
.h2{position:absolute;left:63px;top:137px;font-size:30px;line-height:38px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.lead{position:absolute;left:683px;width:424px;top:135px;font-size:13.5px;line-height:21px;color:var(--tx2)}
.cap{font-size:9.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--tx2)}
.card{position:absolute;border-radius:18px;border:1px solid var(--ln);background:var(--card);overflow:hidden}
.card.bgc{background:var(--bg);border-color:var(--line-d)}
.card.pc{background:var(--primary);border-color:transparent}
.card.pcb{background:var(--primary);border-color:var(--line-l)}
.card.gc{background:var(--grey);border-color:transparent}
.card.ac{background:var(--acc);border-color:transparent}
.ctr{display:flex;align-items:center;justify-content:center}
.tbl{border-top:1px solid var(--ln)}
.tr{display:grid;align-items:center;border-bottom:1px solid var(--ln);min-height:38px;font-size:12.5px;line-height:17px;padding:4px 0}
.tr .a{color:var(--tx2)}
.tr .b{font-weight:600}
.tr.c2{grid-template-columns:152px 1fr}
.mono{font-family:'JetBrains Mono',monospace}
.t12{font-size:12.5px;line-height:19px;color:var(--tx2)}
.t11{font-size:11.5px;line-height:17px;color:var(--tx2)}
.b600{font-weight:600}
.dv-num{position:absolute;left:52px;top:23px;font-size:360px;line-height:1;font-weight:300;letter-spacing:-.03em;color:var(--acc);white-space:nowrap}
.dv-t{position:absolute;left:63px;bottom:136px}
.dv-t h1{font-weight:300;font-size:54px;line-height:60px;letter-spacing:-.015em}
.dv-t p{margin-top:14px;font-size:17px;line-height:24px;color:var(--tx2)}
.dv-l{position:absolute;left:772px;right:63px;bottom:143px;border-top:1px solid var(--ln)}
.dv-l div{display:grid;grid-template-columns:43px 1fr auto;align-items:center;height:33.4px;border-bottom:1px solid var(--ln);font-size:12px}
.dv-l b{font-weight:600;color:var(--acc);letter-spacing:.02em}
.dv-l em{font-style:normal}
.dv-l span{color:var(--tx2);font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%}
`;

export function hdr(label, num, theme) {
  const fill = theme === 'dark' ? C.primary : C.bg;
  return `<div class="hdr"><div>${G.inlineLockup('horizontal', fill)}</div>` +
    `<div class="sec">${num ? `<i>${num}</i>` : ''}${label}</div></div>`;
}
export const ftr = id => `<div class="ftr"><span>404 · Бренд-гайд</span><b>${pn(id)}</b></div>`;

// обычная страница
export function page(id, theme, inner, { label = '', num = '' } = {}) {
  return `<section class="page ${theme}" id="${id}">${hdr(label, num, theme)}${inner}${ftr(id)}</section>`;
}

export const top = (k, title, lead) =>
  `<div class="k">${k}</div><div class="h2">${title}</div>${lead ? `<div class="lead">${lead}</div>` : ''}`;

export const box = (style, inner = '', cls = '') => `<div class="${cls}" style="position:absolute;${style}">${inner}</div>`;

export const rows = (list, { cols = 'c2', style = '' } = {}) =>
  `<div class="tbl" style="${style}">${list.map(([a, b]) => `<div class="tr ${cols}"><div class="a">${a}</div><div class="b">${b}</div></div>`).join('')}</div>`;

export function divider(id, n, title, sub, items) {
  return `<section class="page dark" id="${id}">
  <div class="dv-num">${n}</div>
  <div class="dv-t"><h1>${title}</h1><p>${sub}</p></div>
  <div class="dv-l">${items.map(([k, t, pid]) => `<div><b>${k}</b><em>${t}</em><span>${pn(pid)}</span></div>`).join('')}</div>
  ${ftr(id)}
  </section>`;
}
