// 404 · сборка пакета логотипов: SVG, PDF, PNG, фавикон — из одной геометрии
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import * as G from './geometry.mjs';
import { tokensCss, tailwindPreset } from './tokens.mjs';

const { COLORS: C, MARK, WORD, LOCKUP_H, LOCKUP_V } = G;
const FILL = { cream: C.primary, dark: C.bg, black: C.black, white: C.white };
const BGS = { background: C.bg, primary: C.primary, grey: C.grey, accent: C.accent };
const ON = { background: C.primary, primary: C.bg, grey: C.primary, accent: C.bg };

const sized = (svg, w, h) => svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

// клад-плитка: знак по центру плашки, высота знака = frac стороны
export function tileSVG(size, bg, fg, { radius = 0, frac = 0.56 } = {}) {
  const h = size * frac, w = MARK.w * h / MARK.h;
  const s = h / MARK.h;
  const rect = radius ? `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${bg}"/>` : `<rect width="${size}" height="${size}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${rect}<path transform="translate(${(size - w) / 2} ${(size - h) / 2}) scale(${s})" fill="${fg}" d="${MARK.d}"/></svg>`;
}
// знак на прозрачном квадрате
const markSquare = (size, fg, frac = 0.8) => {
  const h = size * frac, s = h / MARK.h, w = MARK.w * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path transform="translate(${(size - w) / 2} ${(size - h) / 2}) scale(${s})" fill="${fg}" d="${MARK.d}"/></svg>`;
};
// логотип с охранным полем на холсте w×h (опц. фон), логотип вписан с долей fit
function lockupCanvas(kind, fg, w, h, { bg = null, clear = true, fit = 0.8 } = {}) {
  const L = kind === 'horizontal' ? LOCKUP_H : LOCKUP_V;
  const c = clear ? (kind === 'horizontal' ? (2 / 3) * L.X : L.X) : 0;
  const bw = L.w + 2 * c, bh = L.h + 2 * c;
  const s = Math.min(w * fit / L.w, h * fit / L.h, clear && !bg ? Math.min(w / bw, h / bh) : 99);
  const ox = (w - L.w * s) / 2, oy = (h - L.h * s) / 2;
  const rect = bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${rect}<path transform="translate(${ox} ${oy}) scale(${s})" fill="${fg}" d="${L.d}"/></svg>`;
}
// транспарент-версия с охранным полем: холст = логотип + поле
function lockupPadded(kind, fg, width) {
  const L = kind === 'horizontal' ? LOCKUP_H : LOCKUP_V;
  const c = kind === 'horizontal' ? (2 / 3) * L.X : L.X;
  const bw = L.w + 2 * c, bh = L.h + 2 * c;
  const s = width / bw, w = width, h = Math.round(bh * s);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path transform="translate(${c * s} ${c * s}) scale(${s})" fill="${fg}" d="${L.d}"/></svg>`, w, h };
}

export async function buildPackage(browser, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const manifest = [];
  const add = (rel, data) => { write(path.join(outDir, rel), data); manifest.push(rel); };
  const page = await browser.newPage();

  const png = async (rel, svg, w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<body style="margin:0;background:transparent">${sized(svg, w, h)}</body>`);
    const buf = await page.screenshot({ omitBackground: true, type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
    add(rel, buf);
  };
  const pdf = async (rel, svg, w, h) => {
    await page.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) });
    await page.setContent(`<style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0;padding:0;overflow:hidden;width:${w}px;height:${h}px}svg{display:block}</style><body>${sized(svg, w, h)}</body>`);
    const buf = await page.pdf({ width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: '1', margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    add(rel, buf);
  };

  // ---- svg/ (16) ----
  for (const [cn, fill] of Object.entries(FILL)) {
    add(`svg/404-logo-${cn}.svg`, G.markSVG(fill));
    add(`svg/404-lockup-horizontal-${cn}.svg`, G.lockupSVG('horizontal', fill));
    add(`svg/404-lockup-stacked-${cn}.svg`, G.lockupSVG('stacked', fill));
    add(`svg/404-wordmark-${cn}.svg`, G.wordSVG(fill));
  }
  // ---- pdf/ (9) ----
  const pdfW = 480;
  for (const cn of ['dark', 'black']) {
    const f = FILL[cn];
    await pdf(`pdf/404-logo-${cn}.pdf`, markSVG2(f, pdfW), pdfW, Math.round(pdfW * MARK.h / MARK.w));
    await pdf(`pdf/404-lockup-horizontal-${cn}.pdf`, G.lockupSVG('horizontal', f), pdfW, Math.round(pdfW * LOCKUP_H.h / LOCKUP_H.w));
    await pdf(`pdf/404-lockup-stacked-${cn}.pdf`, G.lockupSVG('stacked', f), pdfW, Math.round(pdfW * LOCKUP_V.h / LOCKUP_V.w));
  }
  {
    const pad = 0.5 * MARK.h;
    const mw = 480, ms = mw / (MARK.w + 2 * pad), mh = Math.round((MARK.h + 2 * pad) * ms);
    await pdf('pdf/404-logo-cream-on-background.pdf', G.markSVG(C.primary, { pad, bg: C.bg }), mw, mh);
    const padH = (2 / 3) * LOCKUP_H.X, sH = 720 / (LOCKUP_H.w + 2 * padH);
    await pdf('pdf/404-lockup-horizontal-cream-on-background.pdf', G.lockupSVG('horizontal', C.primary, { pad: padH, bg: C.bg }), 720, Math.round((LOCKUP_H.h + 2 * padH) * sH));
    const padV = LOCKUP_V.X, sV = 480 / (LOCKUP_V.w + 2 * padV);
    await pdf('pdf/404-lockup-stacked-cream-on-background.pdf', G.lockupSVG('stacked', C.primary, { pad: padV, bg: C.bg }), 480, Math.round((LOCKUP_V.h + 2 * padV) * sV));
  }
  // ---- png/transparent (6) ----
  for (const cn of ['cream', 'dark']) for (const s of [512, 1024, 2048]) await png(`png/transparent/404-logo-${cn}-${s}.png`, markSquare(s, FILL[cn]), s, s);
  // ---- png/lockup-transparent (8) ----
  for (const kind of ['horizontal', 'stacked']) for (const cn of ['cream', 'dark']) for (const w of [1200, 2400]) {
    const { svg, w: W, h: H } = lockupPadded(kind, FILL[cn], w);
    await png(`png/lockup-transparent/404-lockup-${kind}-${cn}-${w}.png`, svg, W, H);
  }
  // ---- png/backgrounds (4) ----
  for (const [bn, bg] of Object.entries(BGS)) await png(`png/backgrounds/404-logo-on-${bn}.png`, tileSVG(1024, bg, ON[bn], { frac: 0.5 }), 1024, 1024);
  // ---- png/lockup-backgrounds (8) ----
  for (const [bn, bg] of Object.entries(BGS)) {
    await png(`png/lockup-backgrounds/404-lockup-horizontal-on-${bn}-2000x750.png`, lockupCanvas('horizontal', ON[bn], 2000, 750, { bg, fit: 0.5 }), 2000, 750);
    await png(`png/lockup-backgrounds/404-lockup-stacked-on-${bn}-1200x1200.png`, lockupCanvas('stacked', ON[bn], 1200, 1200, { bg, fit: 0.5 }), 1200, 1200);
  }
  // ---- png/social (3) ----
  await png('png/social/404-avatar-background.png', tileSVG(1080, C.bg, C.primary, { frac: 0.5 }), 1080, 1080);
  await png('png/social/404-avatar-primary.png', tileSVG(1080, C.primary, C.bg, { frac: 0.5 }), 1080, 1080);
  await png('png/social/404-og-1200x630.png', lockupCanvas('horizontal', C.primary, 1200, 630, { bg: C.bg, fit: 0.46 }), 1200, 630);
  // ---- png/app-icon (4) ----
  await png('png/app-icon/404-icon-dark-1024.png', tileSVG(1024, C.bg, C.primary, { radius: 0.224 }), 1024, 1024);
  await png('png/app-icon/404-icon-light-1024.png', tileSVG(1024, C.primary, C.bg, { radius: 0.224 }), 1024, 1024);
  await png('png/app-icon/404-icon-dark-square-1024.png', tileSVG(1024, C.bg, C.primary), 1024, 1024);
  await png('png/app-icon/404-icon-light-square-1024.png', tileSVG(1024, C.primary, C.bg), 1024, 1024);
  // ---- favicon (6) ----
  add('favicon/favicon.svg', tileSVG(64, C.bg, C.primary, { radius: 0.224 }));
  await png('favicon/favicon-32.png', tileSVG(64, C.bg, C.primary, { radius: 0.224 }), 32, 32);
  await png('favicon/apple-touch-icon.png', tileSVG(180, C.bg, C.primary), 180, 180);
  await png('favicon/icon-192.png', tileSVG(192, C.bg, C.primary), 192, 192);
  await png('favicon/icon-512.png', tileSVG(512, C.bg, C.primary), 512, 512);
  {
    const tmp = path.join(outDir, '.ico');
    fs.mkdirSync(tmp, { recursive: true });
    for (const s of [16, 32, 48]) {
      await page.setViewportSize({ width: s, height: s });
      await page.setContent(`<body style="margin:0;background:transparent">${sized(tileSVG(64, C.bg, C.primary, { radius: 0.224 }), s, s)}</body>`);
      fs.writeFileSync(path.join(tmp, `${s}.png`), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
    }
    execFileSync('convert', [path.join(tmp, '16.png'), path.join(tmp, '32.png'), path.join(tmp, '48.png'), path.join(outDir, 'favicon/favicon.ico')]);
    fs.rmSync(tmp, { recursive: true, force: true });
    manifest.push('favicon/favicon.ico');
  }
  await page.close();

  // ---- README ----
  const readme = `404 · пакет логотипов · версия 2.0

Знак «нерв-щит» и надпись 404. Все файлы выпущены из одной геометрии (brand/src/geometry.mjs).
Правила использования — в брендбуке: brand/404-brandbook.pdf.

ЦВЕТА
  cream  ${C.primary}  Primary  — для тёмных фонов
  dark   ${C.bg}  Background — для светлых фонов
  black  #000000  — одноцветная печать, гравировка
  white  #FFFFFF  — тиснение, плёнки, одноцветная печать

ПАПКИ
  svg/                     знак, горизонтальный и вертикальный логотип, надпись — в четырёх цветах
  pdf/                     вектор для типографии
  png/transparent/         знак на прозрачном квадрате: 512, 1024, 2048 px
  png/lockup-transparent/  логотипы на прозрачном фоне с охранным полем: 1200 и 2400 px
  png/backgrounds/         знак на фирменных фонах, 1024 x 1024 px
  png/lockup-backgrounds/  логотипы на фирменных фонах: 2000 x 750 и 1200 x 1200 px
  png/social/              аватары 1080 x 1080 px, обложка ссылки 1200 x 630 px
  png/app-icon/            иконки приложения 1024 px: скруглённые и квадратные
  favicon/                 favicon.ico, favicon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png

Минимальный размер: знак — 8 мм / 16 px; горизонтальный логотип — 35 мм / 72 px; вертикальный — 18 мм / 64 px.
Охранное поле: знак — 1/2 высоты; горизонтальный логотип — 2/3 X; вертикальный — X (X — высота цифр 404).
Знак не растягивается, не поворачивается, не перекрашивается вне палитры.
`;
  add('README.txt', readme);

  const byDir = {};
  for (const rel of manifest) { const d = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') + '/' : ''; byDir[d] = (byDir[d] || 0) + 1; }
  const desc = {
    'svg/': 'Вектор для веба и печати: знак, два логотипа и надпись в четырёх цветах',
    'pdf/': 'Вектор для типографии: dark и black на прозрачном фоне, cream на фоне Background',
    'png/transparent/': 'Знак на прозрачном фоне: 512, 1024, 2048 px',
    'png/lockup-transparent/': 'Логотипы на прозрачном фоне с охранным полем: 1200 и 2400 px',
    'png/backgrounds/': 'Знак на четырёх фирменных фонах, 1024 × 1024 px',
    'png/lockup-backgrounds/': 'Логотипы на фирменных фонах: 2000 × 750 и 1200 × 1200 px',
    'png/social/': 'Аватары 1080 × 1080 px и обложка ссылки 1200 × 630 px',
    'png/app-icon/': 'Иконки приложения 1024 px: скруглённые и квадратные',
    'favicon/': 'favicon.ico, favicon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png',
  };
  const groups = Object.keys(desc).map(dir => ({ dir, count: byDir[dir] || 0, desc: desc[dir] }));
  return { groups, byDir, total: manifest.length };
}

// SVG знака с прозрачным фоном для PDF
function markSVG2(fill, w) { return G.markSVG(fill); }

export function writeTokens(brandDir) {
  write(path.join(brandDir, 'tokens/tokens.css'), tokensCss);
  write(path.join(brandDir, 'tokens/tailwind.preset.cjs'), tailwindPreset);
}
