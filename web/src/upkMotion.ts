/**
 * Движение интерфейса в оформлении «УПК» — мотив воды: всё, что происходит, — круги на воде.
 *  — указатель мыши — маленький поплавок: качается за мышью, над кнопкой «клюёт» (ныряет и встаёт),
 *    при нажатии ныряет, и от точки расходятся круги; за быстрым движением остаётся тихий след;
 *  — новый раздел и новая тема всплывают из точки нажатия волнистой кромкой, как круг от капли
 *    (View Transitions), прежний экран уходит вглубь и темнеет;
 *  — выделенный текст светится, а когда его отпустили или скопировали, от конца расходятся круги;
 *  — «магнитные» главные кнопки; номера и отпечатки перебираются и встают на место.
 * Работает только в оформлении «УПК» (design.ts); при «уменьшить движение» — выключено.
 * Поплавок и круги от выделения — только для мыши: на телефоне остаются системные жесты.
 */
import { flushSync } from 'react-dom';
import { design } from './design';
import { introPlaying } from './introBus';

const ON = design === 'upk';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fineMouse = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Круги на воде из точки: несколько эллипсов расходятся и тают (вода видна чуть сверху — круги сплюснуты) */
export function ripples(cx: number, cy: number, { count = 3, size = 70, duration = 1100, strong = false } = {}) {
  if (!ON || reduced()) return;
  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('div');
    el.className = `ripple${strong ? ' is-strong' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
    const s = size * (1 - i * 0.18);
    const anim = el.animate(
      [
        { transform: `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%) scale(0.12)`, opacity: 0.9 },
        { transform: `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%) scale(1)`, opacity: 0 },
      ],
      { duration: duration + i * 120, delay: i * 140, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' },
    );
    el.style.width = `${s * 2}px`;
    el.style.height = `${s * 0.8}px`;
    anim.onfinish = anim.oncancel = () => el.remove();
  }
}

// ---------- всплытие: кромка круга от капли, волнистая ----------
/** Кадры clip-path: круг из точки растёт, по краю бежит затухающая волна */
function waveFrames(cx: number, cy: number, radius: number, steps = 20) {
  const N = 72, frames: string[] = [];
  for (let f = 0; f <= steps; f++) {
    const k = f / steps;
    const r = radius * 1.08 * (1 - (1 - k) ** 2.2);
    const amp = 0.07 * (1 - k);
    const pts: string[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = r * (1 + amp * Math.sin(a * 7 + k * 9) + amp * 0.6 * Math.sin(a * 3 - k * 6));
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)}px ${(cy + Math.sin(a) * rr).toFixed(1)}px`);
    }
    frames.push(`polygon(${pts.join(',')})`);
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
 * Смена экрана: новое состояние всплывает из точки нажатия волнистой кромкой, прежнее отступает вглубь
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
    root.animate({ clipPath: waveFrames(x, y, radius) }, { duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' });
    ripples(x, y, { count: 2, size: 120, duration: 900 });
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

// ---------- указатель-поплавок ----------
const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], [role="radio"], [role="option"], label, select, summary, input[type="range"], input[type="checkbox"], .buoy, .leaflet-interactive, [tabindex]:not([tabindex="-1"])';
const TEXT_FIELD = 'input:not([type="checkbox"], [type="radio"], [type="file"], [type="button"], [type="submit"], [type="range"]), textarea, [contenteditable="true"]';
const DISABLED = 'button:disabled, input:disabled, select:disabled, [aria-disabled="true"]';
const FOLLOW = 0.32;       // поплавок догоняет мышь с небольшой задержкой — как на воде
const WAKE_STEP = 120;     // через сколько пикселей быстрого пути оставлять тихий след
/**
 * Поплавок в стиле знака 404: тонкая игла, как у знака, и кольцо с точкой, как у буя на карте;
 * без заливок, только линии. Точка указателя — на ватерлинии.
 */
const FLOAT = '<svg viewBox="0 0 20 40" aria-hidden="true"><path class="f-needle" d="M10 2v36"/><circle class="f-ring" cx="10" cy="18" r="5"/><circle class="f-dot" cx="10" cy="18" r="1.6"/></svg>';

function startCursor() {
  const float = document.createElement('div');
  float.className = 'float';
  float.setAttribute('aria-hidden', 'true');
  float.innerHTML = `<div class="float-tilt"><div class="float-bob">${FLOAT}</div><div class="float-beam"><i></i></div></div><span class="float-ring"></span>`;
  const tilt = float.firstElementChild as HTMLElement;
  let x = 0, y = 0, fx = 0, fy = 0, vx = 0, frame = 0, shown = false, travelled = 0;
  let lastTarget: EventTarget | null = null;
  const tick = () => {
    frame = 0;
    const nx = fx + (x - fx) * FOLLOW, ny = fy + (y - fy) * FOLLOW;
    vx += ((nx - fx) - vx) * 0.25;
    fx = nx; fy = ny;
    float.style.transform = `translate3d(${fx}px, ${fy}px, 0)`;
    tilt.style.transform = `rotate(${Math.max(-22, Math.min(22, vx * 1.6))}deg)`;
    if (Math.abs(x - fx) + Math.abs(y - fy) > 0.2 || Math.abs(vx) > 0.05) frame = requestAnimationFrame(tick);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };
  const show = () => {
    if (shown) return;
    shown = true;
    if (!float.isConnected) {
      document.body.append(float);
      document.documentElement.classList.add('has-cursor');
    }
    fx = x; fy = y; travelled = 0;
    float.classList.add('is-on');
  };
  const hide = () => { shown = false; float.classList.remove('is-on'); };
  const describe = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const disabled = !!target.closest(DISABLED);
    const text = !disabled && !!target.closest(TEXT_FIELD);
    float.classList.toggle('is-disabled', disabled);
    float.classList.toggle('is-text', text);
    float.classList.toggle('is-bite', !disabled && !text && !!target.closest(INTERACTIVE));
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') { hide(); return; }
    const distance = shown ? Math.hypot(e.clientX - x, e.clientY - y) : 0;
    x = e.clientX; y = e.clientY;
    show();
    if (e.target !== lastTarget) { lastTarget = e.target; describe(e.target); }
    // быстрое движение оставляет на воде тихий след
    travelled += distance > 6 ? distance : 0;
    if (travelled >= WAKE_STEP && !float.classList.contains('is-text')) {
      travelled = 0;
      ripples(x, y, { count: 1, size: 26, duration: 900 });
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
    float.classList.add('is-down');
    if (!float.classList.contains('is-text')) {
      const strong = e.target instanceof Element && !!e.target.closest('.ui-btn-primary, .ui-btn-danger');
      ripples(x, y, { count: 3, size: strong ? 90 : 60, strong });
    }
  }, { passive: true });
  const release = () => float.classList.remove('is-down');
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('blur', release);
  document.documentElement.addEventListener('mouseleave', hide);
}

// ---------- выделение: от конца расходятся круги ----------
function startSelection() {
  const LINE_MAX = 120;   // прямоугольник выше этого — целый блок, а не строка текста
  const endPoint = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    if (document.activeElement?.matches?.('input, textarea')) return null;
    const lines = [...selection.getRangeAt(0).getClientRects()].filter((r) => r.width > 0.5 && r.height > 0 && r.height < LINE_MAX);
    const tail = lines[lines.length - 1];
    return tail ? { x: tail.right, y: tail.bottom - 2 } : null;
  };
  const ring = () => { const p = endPoint(); if (p) ripples(p.x, p.y, { count: 2, size: 34, duration: 900 }); };
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    requestAnimationFrame(ring);
  }, { passive: true });
  document.addEventListener('copy', ring);
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
