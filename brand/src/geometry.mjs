// 404 · геометрия знака и надписи
// Все контуры строятся из чисел здесь — брендбук, SVG/PNG/PDF-пакет и токены берут размеры отсюда.

export const COLORS = {
  primary: '#E2E8F0',   // Пенный
  bg: '#0B1628',        // Ночной
  surface: '#142236',   // Глубинный
  grey: '#64748B',      // Сланцевый
  accent: '#2DD4BF',    // Бирюзовый (он же «Норма»)
  warn: '#F59E0B',      // Янтарный
  alert: '#EF4444',     // Коралловый
  black: '#000000',
  white: '#FFFFFF',
};

// ---------- мини-библиотека путей (только абсолютные M L C Q Z) ----------
const r2 = n => Math.round(n * 100) / 100;

export function parse(d) {
  const segs = [];
  const re = /([MLCQZ])([^MLCQZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const args = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    segs.push([m[1], ...args]);
  }
  return segs;
}

export function toD(segs) {
  return segs.map(s => s[0] + s.slice(1).map(r2).join(' ')).join('');
}

// аффинное преобразование: x' = a*x + e, y' = dd*y + f
export function xform(segs, { a = 1, dd = 1, e = 0, f = 0 }) {
  return segs.map(s => {
    if (s[0] === 'Z') return ['Z'];
    const out = [s[0]];
    for (let i = 1; i < s.length; i += 2) out.push(a * s[i] + e, dd * s[i + 1] + f);
    return out;
  });
}

const kappa = 0.5522847498;
// окружность / скруглённый прямоугольник сразу в кубических кривых (по часовой, в экранных координатах)
export function circle(cx, cy, r) {
  const k = r * kappa;
  return parse(
    `M${cx},${cy - r} C${cx + k},${cy - r} ${cx + r},${cy - k} ${cx + r},${cy} ` +
    `C${cx + r},${cy + k} ${cx + k},${cy + r} ${cx},${cy + r} ` +
    `C${cx - k},${cy + r} ${cx - r},${cy + k} ${cx - r},${cy} ` +
    `C${cx - r},${cy - k} ${cx - k},${cy - r} ${cx},${cy - r} Z`
  );
}
export function rrect(x, y, w, h, r) {
  const k = r * kappa;
  return parse(
    `M${x + r},${y} L${x + w - r},${y} C${x + w - r + k},${y} ${x + w},${y + r - k} ${x + w},${y + r} ` +
    `L${x + w},${y + h - r} C${x + w},${y + h - r + k} ${x + w - r + k},${y + h} ${x + w - r},${y + h} ` +
    `L${x + r},${y + h} C${x + r - k},${y + h} ${x},${y + h - r + k} ${x},${y + h - r} ` +
    `L${x},${y + r} C${x},${y + r - k} ${x + r - k},${y} ${x + r},${y} Z`
  );
}

// точки вдоль контура (для bbox и ориентации)
function sample(segs, n = 40) {
  const pts = [];
  let cur = null;
  for (const s of segs) {
    if (s[0] === 'M') { cur = [s[1], s[2]]; pts.push(cur); }
    else if (s[0] === 'L') { cur = [s[1], s[2]]; pts.push(cur); }
    else if (s[0] === 'Q') {
      const [x0, y0] = cur;
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([u * u * x0 + 2 * u * t * s[1] + t * t * s[3], u * u * y0 + 2 * u * t * s[2] + t * t * s[4]]);
      }
      cur = [s[3], s[4]];
    } else if (s[0] === 'C') {
      const [x0, y0] = cur;
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([
          u * u * u * x0 + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
          u * u * u * y0 + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6],
        ]);
      }
      cur = [s[5], s[6]];
    }
  }
  return pts;
}

export function signedArea(segs) {
  const p = sample(segs);
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function bbox(subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const segs of subs) for (const [x, y] of sample(segs, 80)) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// разворот замкнутого подконтура
export function reverse(segs) {
  const start = [segs[0][1], segs[0][2]];
  let cur = start;
  const chain = [];
  for (const s of segs.slice(1)) {
    if (s[0] === 'Z') break;
    if (s[0] === 'L') { chain.push({ t: 'L', from: cur, c: [], to: [s[1], s[2]] }); cur = [s[1], s[2]]; }
    if (s[0] === 'Q') { chain.push({ t: 'Q', from: cur, c: [[s[1], s[2]]], to: [s[3], s[4]] }); cur = [s[3], s[4]]; }
    if (s[0] === 'C') { chain.push({ t: 'C', from: cur, c: [[s[1], s[2]], [s[3], s[4]]], to: [s[5], s[6]] }); cur = [s[5], s[6]]; }
  }
  if (cur[0] !== start[0] || cur[1] !== start[1]) chain.push({ t: 'L', from: cur, c: [], to: start });
  const out = [['M', start[0], start[1]]];
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i];
    if (c.t === 'L') out.push(['L', c.from[0], c.from[1]]);
    if (c.t === 'Q') out.push(['Q', c.c[0][0], c.c[0][1], c.from[0], c.from[1]]);
    if (c.t === 'C') out.push(['C', c.c[1][0], c.c[1][1], c.c[0][0], c.c[0][1], c.from[0], c.from[1]]);
  }
  out.push(['Z']);
  return out;
}

// solid → положительная площадь, hole → отрицательная (fill-rule nonzero)
function orient(segs, hole) {
  const a = signedArea(segs);
  const wantPositive = !hole;
  return (a > 0) === wantPositive ? segs : reverse(segs);
}

// ---------- ЗНАК «нерв-щит» ----------
// Сырые координаты (холст 1000 × 1250, ось симметрии x = 500)
const RAW = {
  blade: 'M978,290 C1008,760 822,1052 560,1192 C664,1040 826,796 978,290 Z',
  nerve: 'M506,1060 C520,880 600,700 700,540 L738,556 C688,720 600,900 506,1010 Z',
  stem: 'M461,215 Q486,760 500,1250 Q514,760 539,215 Z',
  top: { cx: 500, cy: 100, ro: 100, ri: 68, dot: 32 },
  side: { cx: 722, cy: 500, ro: 56, ri: 26, dot: 10 },
};
const mirrorX = { a: -1, e: 1000 };

function rawParts() {
  const solids = [];
  const holes = [];
  const add = (segs, hole = false) => (hole ? holes : solids).push(segs);
  add(parse(RAW.stem));
  for (const m of [null, mirrorX]) {
    const t = segs => (m ? xform(segs, m) : segs);
    add(t(parse(RAW.blade)));
    add(t(parse(RAW.nerve)));
    const s = RAW.side;
    add(t(circle(s.cx, s.cy, s.ro)));
    add(t(circle(s.cx, s.cy, s.ri)), true);
    add(t(circle(s.cx, s.cy, s.dot)));
  }
  const t0 = RAW.top;
  add(circle(t0.cx, t0.cy, t0.ro));
  add(circle(t0.cx, t0.cy, t0.ri), true);
  add(circle(t0.cx, t0.cy, t0.dot));
  return { solids, holes };
}

// нормализация: bbox → начало координат
const parts = rawParts();
const bb0 = bbox([...parts.solids, ...parts.holes]);
const norm = { e: -bb0.x0, f: -bb0.y0 };

const solids = parts.solids.map(s => orient(xform(s, norm), false));
const holes = parts.holes.map(s => orient(xform(s, norm), true));

export const MARK = {
  w: r2(bb0.w),
  h: r2(bb0.h),
  d: toD([...solids, ...holes].flat()),
  // детали для чертежа конструкции (в нормализованных координатах знака)
  pct: (() => {
    const T = RAW.top, S = RAW.side;
    const ty = v => (v - bb0.y0) / bb0.h * 100;
    return {
      ratio: bb0.h / bb0.w,
      topNodeBottom: ty(T.cy + T.ro),
      bladeTop: ty(290),
      sideNodeCenter: ty(S.cy),
      sideNodeTop: ty(S.cy - S.ro),
      sideNodeBottom: ty(S.cy + S.ro),
      nerveBase: ty(1035),
      bladeBottom: ty(1192),
      stemTopW: (539 - 461) / bb0.w * 100,
      topNodeW: (2 * T.ro) / bb0.w * 100,
      sideNodeW: (2 * S.ro) / bb0.w * 100,
      sideNodeCx: (S.cx - bb0.x0) / bb0.w * 100,
      stemTop: ty(215),
    };
  })(),
};

// ---------- НАДПИСЬ 404 (цифры высотой 100) ----------
const DIGIT_W = 125, GAP = 17;
function four(x0) {
  const outer = parse(
    `M${x0 + 80},0 L${x0 + 102},0 L${x0 + 102},62 L${x0 + 125},62 L${x0 + 125},84 L${x0 + 102},84 ` +
    `L${x0 + 102},100 L${x0 + 80},100 L${x0 + 80},84 L${x0},84 L${x0},62 Z`
  );
  const hole = parse(`M${x0 + 80},20.2 L${x0 + 80},62 L${x0 + 26},62 Z`);
  return { solids: [outer], holes: [hole] };
}
function zero(x0) {
  return {
    solids: [rrect(x0, 0, DIGIT_W, 100, 36), circle(x0 + DIGIT_W / 2, 50, 9.5)],
    holes: [rrect(x0 + 23, 22, DIGIT_W - 46, 56, 15)],
  };
}
const glyphs = [four(0), zero(DIGIT_W + GAP), four(2 * (DIGIT_W + GAP))];
const wmSolids = glyphs.flatMap(g => g.solids).map(s => orient(s, false));
const wmHoles = glyphs.flatMap(g => g.holes).map(s => orient(s, true));
export const WORD = {
  w: 3 * DIGIT_W + 2 * GAP,
  h: 100,
  segs: [...wmSolids, ...wmHoles].flat(),
  solids: wmSolids,
  holes: wmHoles,
  d: toD([...wmSolids, ...wmHoles].flat()),
  digitW: DIGIT_W,
  gap: GAP,
};

// ---------- ЛОГОТИПЫ ----------
// X = высота цифр. Горизонтальный: знак 4/3 X, зазор ½ X, по центру надписи.
// Вертикальный: знак 2 X, зазор ½ X, знак по центру надписи.
const markSegs = parse(MARK.d);
const placeMark = (hMark, x, y) => {
  const s = hMark / MARK.h;
  return xform(markSegs, { a: s, dd: s, e: x, f: y });
};
const placeWord = (x, y) => xform(WORD.segs, { e: x, f: y });

export function lockup(kind) {
  const X = 100;
  if (kind === 'horizontal') {
    const hm = (4 / 3) * X, wm = MARK.w * hm / MARK.h;
    const word = placeWord(wm + X / 2, (hm - X) / 2);
    const mark = placeMark(hm, 0, 0);
    return { w: r2(wm + X / 2 + WORD.w), h: r2(hm), d: toD(mark) + toD(word), X, hm, wm, gap: X / 2 };
  }
  const hm = 2 * X, wm = MARK.w * hm / MARK.h;
  const W = Math.max(WORD.w, wm);
  const mark = placeMark(hm, (W - wm) / 2, 0);
  const word = placeWord((W - WORD.w) / 2, hm + X / 2);
  return { w: r2(W), h: r2(hm + X / 2 + X), d: toD(mark) + toD(word), X, hm, wm, gap: X / 2 };
}

export const LOCKUP_H = lockup('horizontal');
export const LOCKUP_V = lockup('stacked');

// ---------- SVG-обёртки ----------
const svg = (w, h, inner, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}" ${extra}>${inner}</svg>`;

export const markSVG = (fill, opts = {}) => {
  const { pad = 0, bg = null, extra = '' } = opts;
  const w = MARK.w + 2 * pad, h = MARK.h + 2 * pad;
  const inner = (bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '') +
    `<path transform="translate(${pad} ${pad})" fill="${fill}" d="${MARK.d}"/>`;
  return svg(w, h, inner, extra);
};
export const wordSVG = (fill, opts = {}) => {
  const { pad = 0, bg = null, extra = '' } = opts;
  const w = WORD.w + 2 * pad, h = WORD.h + 2 * pad;
  const inner = (bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '') +
    `<path transform="translate(${pad} ${pad})" fill="${fill}" d="${WORD.d}"/>`;
  return svg(w, h, inner, extra);
};
export const lockupSVG = (kind, fill, opts = {}) => {
  const L = kind === 'horizontal' ? LOCKUP_H : LOCKUP_V;
  const { pad = 0, bg = null, w: forceW, h: forceH, extra = '' } = opts;
  const W = forceW ?? L.w + 2 * pad, H = forceH ?? L.h + 2 * pad;
  const ox = (W - L.w) / 2, oy = (H - L.h) / 2;
  const inner = (bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : '') +
    `<path transform="translate(${r2(ox)} ${r2(oy)})" fill="${fill}" d="${L.d}"/>`;
  return svg(W, H, inner, extra);
};

// инлайновые версии для страниц (width/height задаёт CSS)
export const inlineMark = (fill, style = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.w} ${MARK.h}" style="${style}"><path fill="${fill}" d="${MARK.d}"/></svg>`;
export const inlineWord = (fill, style = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WORD.w} ${WORD.h}" style="${style}"><path fill="${fill}" d="${WORD.d}"/></svg>`;
export const inlineLockup = (kind, fill, style = '') => {
  const L = kind === 'horizontal' ? LOCKUP_H : LOCKUP_V;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.w} ${L.h}" style="${style}"><path fill="${fill}" d="${L.d}"/></svg>`;
};

// ---------- контраст WCAG ----------
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const lum = h => { const [r, g, b] = hex2rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
export const wcag = c => (c >= 7 ? 'AAA' : c >= 4.5 ? 'AA' : c >= 3 ? 'AA Large' : '—');
export const mix = (fg, bg, a) => {
  const f = hex2rgb(fg), b = hex2rgb(bg);
  return '#' + f.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase();
};
export const rgbOf = hex2rgb;
export const cmykOf = h => {
  const [r, g, b] = hex2rgb(h).map(v => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map(v => Math.round(v * 100));
};
