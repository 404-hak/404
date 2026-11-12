/**
 * Движение интерфейса с прошлого сайта команды (404 · УПК), перенесённое как есть по смыслу:
 *  — свой указатель мыши: четырёхлучевая искра из знака 404 с кольцом, следом и вспышкой на нажатие;
 *  — искры на краях выделенного текста и вспышка, когда выделение отпустили или скопировали;
 *  — новый раздел и новая тема раскрываются знаком 404 из точки нажатия (View Transitions);
 *  — «магнитные» главные кнопки: тянутся за курсором на пару пикселей;
 *  — номера и отпечатки «перебираются» и встают на место слева направо.
 * Работает только в оформлении «УПК» (design.ts); при «уменьшить движение» — выключено.
 * Указатель и искры выделения — только для мыши: на телефоне остаются системные жесты.
 */
import { flushSync } from 'react-dom';
import { design } from './design';
import { introPlaying } from './introBus';

const ON = design === 'upk';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fineMouse = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Искра знака 404 */
export const SPARK_PATH = 'M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z';
const SHAPE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK_PATH}"/></svg>`;

function part(className: string, inner: string) {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = inner;
  return el;
}

/** Вспышка: искры разлетаются из точки по кругу */
export function sparks(cx: number, cy: number, radius: number, count = 8) {
  if (!ON || reduced()) return;
  const turn = Math.random() * 45;
  for (let i = 0; i < count; i += 1) {
    const angle = ((turn + (i * 360) / count) * Math.PI) / 180;
    const far = radius + 16 + Math.random() * 22;
    const bit = part('cursor-bit', SHAPE);
    document.body.append(bit);
    const anim = bit.animate(
      [
        { transform: `translate3d(${cx + Math.cos(angle) * radius}px, ${cy + Math.sin(angle) * radius}px, 0) scale(0.9)`, opacity: 1 },
        { transform: `translate3d(${cx + Math.cos(angle) * far}px, ${cy + Math.sin(angle) * far}px, 0) scale(0) rotate(120deg)`, opacity: 0 },
      ],
      { duration: 560, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    );
    anim.onfinish = anim.oncancel = () => bit.remove();
  }
}

// ---------- раскрытие знаком 404 ----------
let unit: [number, number][] | null = null;
/** Отрезки кривых знака → многоугольник для clip-path */
function unitShape() {
  if (unit) return unit;
  const n = SPARK_PATH.match(/-?\d*\.?\d+/g)!.map(Number);
  let px = n[0], py = n[1];
  unit = [];
  for (let i = 2; i + 5 < n.length; i += 6) {
    for (let k = 0; k < 8; k++) {
      const t = k / 8, u = 1 - t;
      const bx = u * u * u * px + 3 * u * u * t * n[i] + 3 * u * t * t * n[i + 2] + t * t * t * n[i + 4];
      const by = u * u * u * py + 3 * u * u * t * n[i + 1] + 3 * u * t * t * n[i + 3] + t * t * t * n[i + 5];
      unit.push([(bx - 12) / 12, (by - 12) / 12]);
    }
    px = n[i + 4];
    py = n[i + 5];
  }
  return unit;
}
/** Кадры: знак растёт из точки и поворачивается, пока не закроет область радиусом radius */
function sparkFrames(cx: number, cy: number, radius: number, steps = 18) {
  const shape = unitShape();
  const inner = Math.min(...shape.map((p) => Math.hypot(p[0], p[1])));
  const full = (radius / inner) * 1.15;
  const frames: string[] = [];
  for (let f = 0; f <= steps; f++) {
    const progress = f / steps, size = full * progress;
    const turn = (-50 + 50 * progress) * (Math.PI / 180), cos = Math.cos(turn), sin = Math.sin(turn);
    frames.push(`polygon(${shape.map((p) => `${(cx + (p[0] * cos - p[1] * sin) * size).toFixed(1)}px ${(cy + (p[0] * sin + p[1] * cos) * size).toFixed(1)}px`).join(',')})`);
  }
  return frames;
}

// откуда раскрывать: точка последнего нажатия
const last = { x: 0, y: 0, t: 0 };
if (ON) {
  document.addEventListener('pointerdown', (e) => { last.x = e.clientX; last.y = e.clientY; last.t = performance.now(); }, { capture: true, passive: true });
}

type VT = { ready: Promise<void>; finished: Promise<void> };
/**
 * Смена экрана со знаком 404: новое состояние раскрывается из точки нажатия, прежнее отступает вглубь
 * и темнеет. Где View Transitions нет (или движение выключено, или идёт заставка) — просто смена.
 */
export function sparkTransition(update: () => void, duration = 760) {
  const start = (document as unknown as { startViewTransition?: (cb: () => void) => VT }).startViewTransition;
  if (!ON || !start || reduced() || introPlaying() || document.hidden) { update(); return; }
  const fresh = performance.now() - last.t < 1200;
  const x = fresh ? last.x : innerWidth / 2, y = fresh ? last.y : innerHeight / 2;
  const root = document.documentElement;
  let transition: VT;
  try { transition = start.call(document, () => flushSync(update)); } catch { update(); return; }
  transition.ready.then(() => {
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.animate({ clipPath: sparkFrames(x, y, radius) }, { duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' });
    root.animate({ filter: ['brightness(1.5)', 'brightness(1)'] }, { duration, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' });
    root.animate({ transform: ['scale(1)', 'scale(0.93)'], filter: ['brightness(1)', 'brightness(0.5)'] },
      { duration, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', pseudoElement: '::view-transition-old(root)', fill: 'forwards' });
  }).catch(() => { /* переход пропущен: экран уже на месте */ });
}

// ---------- перебор символов ----------
/** Символы перебираются и встают на место слева направо: номер тревоги, отпечаток */
export function scramble(el: HTMLElement | null, { duration = 900, delay = 0 } = {}) {
  if (!ON || !el || reduced() || el.dataset.scrambled) return;
  const node = el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE ? el.firstChild : null;
  if (!node) return;                       // меняем только сам текстовый узел: React продолжает им управлять
  el.dataset.scrambled = '1';
  const text = node.nodeValue ?? '';
  const DIGITS = '0123456789', LOWER = 'abcdef0123456789', UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const start = performance.now() + delay;
  const tick = (now: number) => {
    if (!node.isConnected || node.nodeValue == null) return;
    const k = Math.min(Math.max((now - start) / duration, 0), 1);
    const locked = Math.floor(k * text.length);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (i < locked || !/[0-9A-Za-z]/.test(c)) out += c;
      else {
        const pool = /\d/.test(c) ? DIGITS : /[a-f]/.test(c) ? LOWER : /[A-Z]/.test(c) ? UPPER : c;
        out += pool[Math.floor(Math.random() * pool.length)];
      }
    }
    node.nodeValue = k < 1 ? out : text;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** ref для React: <span ref={scrambleRef}>…</span> */
export const scrambleRef = (el: HTMLElement | null) => scramble(el);

// ---------- свой указатель ----------
const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], [role="radio"], [role="option"], label, select, summary, input[type="range"], input[type="checkbox"], .buoy, .leaflet-interactive, [tabindex]:not([tabindex="-1"])';
const TEXT_FIELD = 'input:not([type="checkbox"], [type="radio"], [type="file"], [type="button"], [type="submit"], [type="range"]), textarea, [contenteditable="true"]';
const DISABLED = 'button:disabled, input:disabled, select:disabled, [aria-disabled="true"]';
const RING_EASE = 0.2;      // кольцо догоняет указатель с небольшой задержкой
const TRAIL_STEP = 64;      // через сколько пикселей пути оставлять след
const MAX_BITS = 16;        // больше частиц разом не нужно: это украшение, а не нагрузка
const BURST_BITS = 6;

function startCursor() {
  const cursor = part('cursor', `<div class="cursor-pose">${SHAPE}</div><div class="cursor-beam"><i></i></div>`);
  const ring = part('cursor-ring', '<i></i>');
  let x = 0, y = 0, ringX = 0, ringY = 0, frame = 0, shown = false, travelled = 0, bits = 0;
  let lastTarget: EventTarget | null = null;
  const place = (el: HTMLElement, px: number, py: number) => { el.style.transform = `translate3d(${px}px, ${py}px, 0)`; };
  const tick = () => {
    frame = 0;
    ringX += (x - ringX) * RING_EASE;
    ringY += (y - ringY) * RING_EASE;
    place(cursor, x, y);
    place(ring, ringX, ringY);
    if (Math.abs(x - ringX) + Math.abs(y - ringY) > 0.2) frame = requestAnimationFrame(tick);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };
  const toggle = (name: string, on: boolean) => { cursor.classList.toggle(name, on); ring.classList.toggle(name, on); };
  const show = () => {
    if (shown) return;
    shown = true;
    if (!cursor.isConnected) {
      document.body.append(ring, cursor);
      document.documentElement.classList.add('has-cursor');
    }
    ringX = x; ringY = y; travelled = 0;
    toggle('is-on', true);
  };
  const hide = () => { shown = false; toggle('is-on', false); };
  const describe = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const disabled = !!target.closest(DISABLED);
    const text = !disabled && !!target.closest(TEXT_FIELD);
    toggle('is-disabled', disabled);
    toggle('is-text', text);
    toggle('is-hover', !disabled && !text && !!target.closest(INTERACTIVE));
  };
  const spawn = (px: number, py: number, dx: number, dy: number, size: number, duration: number) => {
    if (reduced() || bits >= MAX_BITS) return;
    bits += 1;
    const bit = part('cursor-bit', SHAPE);
    document.body.append(bit);
    const anim = bit.animate(
      [
        { transform: `translate3d(${px}px, ${py}px, 0) scale(${size})`, opacity: 0.9 },
        { transform: `translate3d(${px + dx}px, ${py + dy}px, 0) scale(0) rotate(90deg)`, opacity: 0 },
      ],
      { duration, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    );
    anim.onfinish = anim.oncancel = () => { bit.remove(); bits -= 1; };
  };
  const burst = () => {
    const turn = Math.random() * 60;
    for (let i = 0; i < BURST_BITS; i += 1) {
      const angle = ((turn + i * 60) * Math.PI) / 180, distance = 22 + Math.random() * 14;
      spawn(x, y, Math.cos(angle) * distance, Math.sin(angle) * distance, 0.55 + Math.random() * 0.4, 520);
    }
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') { hide(); return; }
    const distance = shown ? Math.hypot(e.clientX - x, e.clientY - y) : 0;
    x = e.clientX; y = e.clientY;
    show();
    if (e.target !== lastTarget) { lastTarget = e.target; describe(e.target); }
    travelled += distance;
    if (travelled >= TRAIL_STEP) {
      travelled = 0;
      if (!cursor.classList.contains('is-text')) spawn(x, y, (Math.random() - 0.5) * 14, 6 + Math.random() * 10, 0.3 + Math.random() * 0.3, 650);
    }
    schedule();
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    x = e.clientX; y = e.clientY;
    show();
    lastTarget = e.target;
    describe(e.target);
    schedule();
    toggle('is-down', true);
    if (!cursor.classList.contains('is-text')) burst();
  }, { passive: true });
  const release = () => toggle('is-down', false);
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('blur', release);
  document.documentElement.addEventListener('mouseleave', hide);
}

// ---------- искры выделения ----------
function startSelection() {
  const LINE_MAX = 120;   // прямоугольник выше этого — целый блок, а не строка текста
  const make = (kind: string) => part(`sel-spark ${kind}`, SHAPE);
  const first = make('is-start'), end = make('is-end');
  let frame = 0, endPoint: { x: number; y: number } | null = null;
  const isVisible = (node: Node, x: number, y: number) => {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    for (let el = node instanceof Element ? node : node.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const box = el.getBoundingClientRect();
      if (x < box.left - 1 || x > box.right + 1 || y < box.top - 1 || y > box.bottom + 1) return false;
    }
    return true;
  };
  const selectedRange = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    if (document.activeElement?.matches?.('input, textarea')) return null;
    return selection.getRangeAt(0);
  };
  const place = (el: HTMLElement, x: number, y: number, on: boolean) => {
    if (on && !el.isConnected) document.body.append(el);
    el.classList.toggle('is-on', on);
    if (on) el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const draw = () => {
    frame = 0;
    endPoint = null;
    const range = selectedRange();
    const lines = range ? [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0 && r.height < LINE_MAX) : [];
    if (!range || !lines.length) { place(first, 0, 0, false); place(end, 0, 0, false); return; }
    const head = lines[0], tail = lines[lines.length - 1];
    place(first, head.left, head.top, isVisible(range.startContainer, head.left, head.top));
    const tailOn = isVisible(range.endContainer, tail.right, tail.bottom);
    place(end, tail.right, tail.bottom, tailOn);
    if (tailOn) endPoint = { x: tail.right, y: tail.bottom };
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const burst = () => { if (endPoint) sparks(endPoint.x, endPoint.y, 3, 5); };
  document.addEventListener('selectionchange', schedule);
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    requestAnimationFrame(() => { draw(); burst(); });
  }, { passive: true });
  document.addEventListener('copy', burst);
}

// ---------- магнитные кнопки ----------
function startMagnet() {
  let mag: HTMLElement | null = null, queued: PointerEvent | null = null;
  const clear = () => { mag?.style.removeProperty('--mag-x'); mag?.style.removeProperty('--mag-y'); mag = null; };
  const apply = () => {
    const e = queued;
    queued = null;
    if (!e || !(e.target instanceof Element)) return;
    const btn = e.target.closest<HTMLElement>('.ui-btn-primary:not(:disabled), .ui-btn-danger:not(:disabled)');
    if (btn !== mag) clear();
    if (btn) {
      mag = btn;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty('--mag-x', `${((e.clientX - r.left) / r.width - 0.5) * 7}px`);
      btn.style.setProperty('--mag-y', `${((e.clientY - r.top) / r.height - 0.5) * 5}px`);
    }
  };
  window.addEventListener('pointermove', (e) => { if (!queued) requestAnimationFrame(apply); queued = e; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', clear);
}

let started = false;
export function initUpkMotion() {
  if (!ON || started) return;
  started = true;
  if (reduced() || !fineMouse()) return;
  // в режимах высокой контрастности остаётся системный указатель: человек настроил его под себя
  if (!matchMedia('(forced-colors: active), (prefers-contrast: more)').matches) startCursor();
  startSelection();
  startMagnet();
}
