/**
 * Всё, что браузер рисует по-своему, — в нашем оформлении (как на сайте 404 · УПК):
 *  — подсказки вместо системных (title переносится в data-tip);
 *  — вместо серой строки адреса внизу слева — своя плашка «куда ведёт ссылка»;
 *  — своё меню по правой кнопке: действия с тем, что под мышью (буй, тревога, карта, снимок, звук),
 *    навигация, тема, звук; меню браузера — Shift + правая кнопка;
 *  — своё перетаскивание картинок и ссылок вместо полупрозрачной копии браузера: взятое приподнимается,
 *    идёт за мышью с наклоном, отпустили — пружиной возвращается на место, по воде расходятся круги;
 *  — свой курсор ввода в полях: черта-игла с колечком, плавно переезжает при наборе, от каждой буквы — круг;
 *  — короткие сообщения («Скопировано») внизу экрана.
 * Только оформление «УПК» и мышь: на телефоне и в приложении остаются системные жесты.
 */
import { design } from './design';
import { ripples, floatState } from './upkMotion';
import { reducedMotion } from './motion';

const ON = design === 'upk';
const reduced = () => reducedMotion();
const fineMouse = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const toward = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------- значки 16×16, линии как у знака ----------
const P: Record<string, string> = {
  copy: 'M5.5 5.5h7v8h-7z M3.5 10.5v-8h7',
  external: 'M9.5 2.5h4v4 M13.5 2.5 8 8 M11.5 9.5v4h-9v-9h4',
  back: 'M10 3.5 5.5 8l4.5 4.5',
  forward: 'M6 3.5 10.5 8 6 12.5',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.7 M13 2.5v3h-3',
  link: 'M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.7.7 M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.7-.7',
  print: 'M4.5 6V2.5h7V6 M4.5 11.5h-2v-5h11v5h-2 M4.5 9.5h7v4h-7z',
  moon: 'M13 9.6A5.4 5.4 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z',
  sun: 'M8 5.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z M8 1.5v1.4 M8 13.1v1.4 M1.5 8h1.4 M13.1 8h1.4 M3.4 3.4l1 1 M11.6 11.6l1 1 M3.4 12.6l1-1 M11.6 4.4l1-1',
  theme: 'M8 2.5a5.5 5.5 0 1 0 0 11z M8 2.5a5.5 5.5 0 1 1 0 11',
  volume: 'M2.5 6h2.5l3.5-3v10L5 10H2.5z M11 5.5a3.5 3.5 0 0 1 0 5 M12.8 3.8a6 6 0 0 1 0 8.4',
  mute: 'M2.5 6h2.5l3.5-3v10L5 10H2.5z M11 6.2l3.4 3.6 M14.4 6.2 11 9.8',
  zoomIn: 'M7 2.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4z M7 5v4 M5 7h4 M10.1 10.1l3.4 3.4',
  zoomOut: 'M7 2.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4z M5 7h4 M10.1 10.1l3.4 3.4',
  fit: 'M2.5 5.5v-3h3 M10.5 2.5h3v3 M13.5 10.5v3h-3 M5.5 13.5h-3v-3 M6 6h4v4H6z',
  pin: 'M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z M8 5.1a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z',
  buoy: 'M8 3.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4z M8 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  play: 'M5.5 3.2v9.6L13 8z',
  pause: 'M5.5 3.5v9 M10.5 3.5v9',
  download: 'M8 2.5v8 M4.5 7 8 10.5 11.5 7 M3 13.5h10',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  chevron: 'M6 3.5 10.5 8 6 12.5',
  expand: 'M9.5 2.5h4v4 M6.5 13.5h-4v-4 M13.5 2.5 9 7 M2.5 13.5 7 9',
  sections: 'M2.5 4h11 M2.5 8h11 M2.5 12h7',
  boat: 'M2 10.5h12l-2.2 3H4.2z M8 2.5v8 M8 3l4.2 5.5H8',
  close: 'M4 4l8 8 M12 4l-8 8',
  select: 'M2.5 4.5v-2h2 M11.5 2.5h2v2 M13.5 11.5v2h-2 M4.5 13.5h-2v-2 M6 8h4',
  intro: 'M8 1.8v12.4 M8 8 4.2 4.2 M8 8l3.8-3.8 M8 11 5 8.5 M8 11l3-2.5',
};
export const icon = (name: string, cls = '') =>
  `<svg class="ui-ic ${cls}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] ?? P.buoy}"/></svg>`;

// ---------- короткие сообщения ----------
let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  if (!toastEl) {
    toastEl = h('<div class="ui-toast" role="status" aria-live="polite"></div>');
    document.body.append(toastEl);
  }
  toastEl.innerHTML = `${icon(kind === 'ok' ? 'check' : 'close')}<span>${esc(text)}</span>`;
  toastEl.classList.toggle('is-error', kind === 'error');
  toastEl.classList.remove('is-on');
  void toastEl.offsetWidth;
  toastEl.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('is-on'), 1800);
  const r = toastEl.getBoundingClientRect();
  ripples(r.left + 22, r.top + r.height / 2, { count: 2, size: 30, duration: 800 });
}

export async function copyText(text: string, what = 'Скопировано') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // запасной путь без доступа к буферу
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast(what);
}

// ---------- подсказки ----------
let tipEl: HTMLElement | null = null;
let tipFor: Element | null = null;
let tipTimer = 0;
function adoptTitle(el: Element) {
  const text = el.getAttribute('title');
  el.removeAttribute('title');
  if (!text) return;
  (el as HTMLElement).dataset.tip = text;
  // подсказка не пропадает для экранных читалок
  if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text);
}
const hideTip = () => { window.clearTimeout(tipTimer); tipFor = null; tipEl?.classList.remove('is-on'); };
function showTip(el: HTMLElement) {
  const text = el.dataset.tip;
  if (!text || !el.isConnected) return;
  if (!tipEl) { tipEl = h('<div class="ui-tip" aria-hidden="true"></div>'); document.body.append(tipEl); }
  tipEl.textContent = text;
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const below = r.bottom + th + 12 < innerHeight;
  tipEl.style.left = `${clamp(r.left + r.width / 2 - tw / 2, 8, innerWidth - tw - 8)}px`;
  tipEl.style.top = `${below ? r.bottom + 9 : r.top - th - 9}px`;
  tipEl.classList.toggle('is-above', !below);
  tipEl.classList.add('is-on');
}
function tipTarget(node: EventTarget | null) {
  const el = (node as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
  if (!el || el.closest('svg, .leaflet-container .leaflet-control-attribution')) return null;
  if (el.hasAttribute('title')) adoptTitle(el);
  return el.dataset.tip ? el : null;
}
function startTips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = tipTarget(e.target);
    if (el === tipFor) return;
    hideTip();
    if (!el || document.documentElement.classList.contains('is-lifting')) return;
    tipFor = el;
    tipTimer = window.setTimeout(() => tipFor === el && showTip(el), 420);
  });
  document.addEventListener('pointerout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget as Node)) hideTip(); });
  document.addEventListener('focusin', (e) => {
    const el = tipTarget(e.target);
    if (el && (e.target as Element).matches(':focus-visible')) { tipFor = el; showTip(el); }
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hideTip());
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
}

// ---------- куда ведёт ссылка ----------
// Пока мышь над ссылкой, адрес лежит в data-href — системная строка внизу не появляется.
// Левая кнопка возвращает его при отпускании (до того как браузер обработает клик), другие кнопки и Enter — сразу.
const LINK = 'a[href], a[data-href]';
const SITE_NAMES: [RegExp, string][] = [
  [/(^|\.)openstreetmap\.org$/, 'OpenStreetMap'],
  [/(^|\.)arcgis(online)?\.com$|(^|\.)esri\.com$/, 'Esri'],
  [/(^|\.)yandex\.(ru|com)$/, 'Яндекс'],
  [/(^|\.)github\.com$/, 'GitHub'],
];
let linkEl: HTMLAnchorElement | null = null;
let linkBox: HTMLElement | null = null;
let linkHide = 0;
export function linkHref(a: Element | null) {
  const raw = a?.getAttribute('href') ?? (a as HTMLElement | null)?.dataset.href;
  if (raw == null) return '';
  try { return new URL(raw, location.href).href; } catch { return ''; }
}
function linkInfo(a: HTMLAnchorElement) {
  let url: URL;
  try { url = new URL(a.getAttribute('href') ?? a.dataset.href ?? '', location.href); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const same = url.origin === location.origin;
  const name = same ? 'На этой странице' : SITE_NAMES.find(([re]) => re.test(url.hostname))?.[1] ?? null;
  let path = same ? url.pathname + url.hash : url.host + url.pathname.replace(/\/$/, '');
  try { path = decodeURI(path); } catch { /* как есть */ }
  return { name, path, away: !same };
}
function stashHref(a: HTMLAnchorElement) {
  if (!a.hasAttribute('href')) return;
  if (!a.hasAttribute('tabindex')) { a.setAttribute('tabindex', '0'); a.dataset.hrefTab = ''; }
  if (!a.hasAttribute('role')) { a.setAttribute('role', 'link'); a.dataset.hrefRole = ''; }
  a.dataset.href = a.getAttribute('href')!;
  a.removeAttribute('href');
}
function restoreHref(a: HTMLAnchorElement | null) {
  if (!a || a.dataset.href === undefined) return;
  if (!a.hasAttribute('href')) a.setAttribute('href', a.dataset.href);
  delete a.dataset.href;
  if (a.dataset.hrefTab !== undefined) { a.removeAttribute('tabindex'); delete a.dataset.hrefTab; }
  if (a.dataset.hrefRole !== undefined) { a.removeAttribute('role'); delete a.dataset.hrefRole; }
}
function showLink(info: NonNullable<ReturnType<typeof linkInfo>>, x: number, y: number) {
  window.clearTimeout(linkHide);
  if (!linkBox) {
    linkBox = h('<div class="ui-link" aria-hidden="true"><span class="ui-link-ic"></span><span class="ui-link-text"></span></div>');
    document.body.append(linkBox);
  }
  linkBox.querySelector('.ui-link-ic')!.innerHTML = icon(info.away ? 'external' : 'buoy');
  linkBox.querySelector('.ui-link-text')!.innerHTML = `${info.name ? `<b>${esc(info.name)}</b>` : ''}<span class="ui-link-url">${esc(info.path)}</span>${info.away ? '<span class="ui-link-flag">новая вкладка</span>' : ''}`;
  linkBox.classList.remove('is-right');
  const r = linkBox.getBoundingClientRect();
  linkBox.classList.toggle('is-right', x < r.width + 40 && y > innerHeight - r.height - 60);
  linkBox.classList.remove('is-swap');
  void linkBox.offsetWidth;
  linkBox.classList.add('is-on', 'is-swap');
}
const hideLink = () => { window.clearTimeout(linkHide); linkHide = window.setTimeout(() => linkBox?.classList.remove('is-on'), 90); };
const leaveLink = () => { if (!linkEl) return; restoreHref(linkEl); linkEl = null; hideLink(); floatState('is-link', false); };
function startLinks() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const a = (e.target as Element)?.closest?.(LINK) as HTMLAnchorElement | null;
    if (a === linkEl) return;
    leaveLink();
    const info = a && linkInfo(a);
    if (!a || !info) return;
    linkEl = a;
    // внешние ссылки открываются в новой вкладке: сайт дежурного не должен уходить
    if (info.away && !a.target) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    stashHref(a);
    floatState('is-link', true);
    if (!document.documentElement.classList.contains('is-lifting')) showLink(info, e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => { if (linkEl && e.pointerType === 'mouse' && !linkEl.contains(e.relatedTarget as Node)) leaveLink(); });
  document.addEventListener('pointerdown', (e) => { if (!linkEl) return; hideLink(); if (e.pointerType !== 'mouse' || e.button !== 0) restoreHref(linkEl); }, true);
  document.addEventListener('pointerup', (e) => { if (linkEl && e.button === 0 && !document.documentElement.classList.contains('is-lifting')) restoreHref(linkEl); }, true);
  document.addEventListener('keydown', (e) => { const t = e.target as HTMLElement; if (e.key === 'Enter' && t?.dataset?.href !== undefined) restoreHref(t as HTMLAnchorElement); }, true);
  const again = () => window.setTimeout(() => {
    if (!linkEl) return;
    if (!linkEl.isConnected) { linkEl = null; return; }
    if (!linkEl.matches(':hover')) return;
    stashHref(linkEl);
  }, 0);
  for (const type of ['click', 'auxclick', 'contextmenu', 'keyup']) document.addEventListener(type, again);
  window.addEventListener('blur', leaveLink);
}

// ---------- своё меню по правой кнопке ----------
export type MenuItem =
  | 'sep'
  | { heading: string }
  | { foot: string }
  | { tools: Action[] }
  | Action;
export type Action = { label: string; ic?: string; hint?: string; action?: () => unknown; items?: MenuItem[]; checked?: boolean; disabled?: boolean; danger?: boolean };
type Provider = { selector: string; build: (el: Element, e: MouseEvent) => { title?: string; items: MenuItem[] } | null };
const providers = new Set<Provider>();
let pageBuild: ((e: MouseEvent) => MenuItem[]) | null = null;

/** Действия правой кнопки для элементов страницы; возвращает функцию снятия */
export function contextActions(selector: string, build: Provider['build']) {
  const p = { selector, build };
  providers.add(p);
  return () => { providers.delete(p); };
}
/** Общие действия (навигация, тема, звук) — одна функция на сайт */
export function pageActions(build: ((e: MouseEvent) => MenuItem[]) | null) { pageBuild = build; }

type Open = { el: HTMLElement; sub: { el: HTMLElement; parent: HTMLElement } | null; target: Element | null; opener: Element | null; at: number };
let menu: Open | null = null;
let subTimer = 0;
let lastPointer = 'mouse';

function closeSub() {
  window.clearTimeout(subTimer);
  const sub = menu?.sub;
  if (!sub || !menu) return;
  menu.sub = null;
  sub.parent.setAttribute('aria-expanded', 'false');
  sub.el.classList.add('is-leaving');
  window.setTimeout(() => sub.el.remove(), 160);
}
function closeMenu(focusBack = true) {
  if (!menu) return;
  closeSub();
  const { el, target, opener } = menu;
  menu = null;
  target?.classList.remove('ctx-target');
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('is-leaving');
  window.setTimeout(() => el.remove(), 160);
  if (focusBack && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
}
function run(it: Action) {
  closeMenu();
  Promise.resolve().then(() => it.action?.()).catch((err) => toast(err?.message || 'Не получилось', 'error'));
}
function menuEl(items: MenuItem[], label: string, sub = false) {
  const handlers: Action[] = [];
  const button = (it: Action) => {
    handlers.push(it);
    const choice = it.checked !== undefined;
    const tail = it.items ? icon('chevron', 'ctx-chevron') : choice ? icon('check', 'ctx-check') : it.hint ? `<kbd>${esc(it.hint)}</kbd>` : '';
    return `<button type="button" class="ctx-item${it.danger ? ' is-danger' : ''}" role="${choice ? 'menuitemradio' : 'menuitem'}" data-h="${handlers.length - 1}"${choice ? ` aria-checked="${it.checked}"` : ''}${it.items ? ' aria-haspopup="menu" aria-expanded="false"' : ''}${it.disabled ? ' disabled' : ''}>${it.ic ? icon(it.ic) : ''}<span class="ctx-label">${esc(it.label)}</span>${tail}</button>`;
  };
  const tool = (it: Action) => {
    handlers.push(it);
    return `<button type="button" class="ctx-item ctx-tool" role="menuitem" aria-label="${esc(it.label)}" data-tip="${esc(it.hint ? `${it.label} · ${it.hint}` : it.label)}" data-h="${handlers.length - 1}"${it.disabled ? ' disabled' : ''}>${icon(it.ic ?? 'buoy')}</button>`;
  };
  const html = items.map((it) => {
    if (it === 'sep') return '<div class="ctx-sep" role="separator"></div>';
    if ('heading' in it) return `<div class="ctx-title">${esc(it.heading)}</div>`;
    if ('foot' in it) return `<div class="ctx-foot">${esc(it.foot)}</div>`;
    if ('tools' in it) return `<div class="ctx-tools" role="group" aria-label="Страница">${it.tools.map(tool).join('')}</div>`;
    return button(it);
  }).join('');
  const el = h(`<div class="ctx-menu${sub ? ' ctx-sub' : ''}" role="menu" aria-label="${esc(label)}">${html}</div>`);
  el.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest('.ctx-item') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const it = handlers[Number(btn.dataset.h)];
    if (it.items) openSub(btn, it, true);
    else run(it);
  });
  el.addEventListener('pointerover', (ev) => {
    window.clearTimeout(subTimer);
    if (sub) return;
    const btn = (ev.target as Element).closest('.ctx-item') as HTMLButtonElement | null;
    if (!btn) return;
    const it = handlers[Number(btn.dataset.h)];
    if (it?.items && !btn.disabled) subTimer = window.setTimeout(() => menu && openSub(btn, it), 140);
    else if (menu?.sub) subTimer = window.setTimeout(closeSub, 260);
  });
  return el;
}
function openSub(parent: HTMLElement, it: Action, focus = false) {
  if (!menu) return;
  window.clearTimeout(subTimer);
  if (menu.sub?.parent !== parent) {
    closeSub();
    const el = menuEl(it.items ?? [], it.label, true);
    document.body.append(el);
    const r = parent.getBoundingClientRect();
    const mw = el.offsetWidth, mh = el.offsetHeight;
    const flip = r.right + mw + 8 > innerWidth;
    el.style.left = `${flip ? Math.max(8, r.left - mw + 2) : r.right - 2}px`;
    el.style.top = `${clamp(r.top - 7, 8, innerHeight - mh - 8)}px`;
    el.classList.toggle('from-right', flip);
    parent.setAttribute('aria-expanded', 'true');
    menu.sub = { el, parent };
  }
  if (focus) (menu.sub!.el.querySelector('.ctx-item:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true });
}
function openMenu(e: MouseEvent) {
  closeMenu(false);
  hideTip();
  const t = e.target as Element;
  const selected = String(getSelection?.() ?? '').trim();
  const a = t.closest?.(LINK) as HTMLAnchorElement | null;
  const link = linkHref(a);
  const opener = document.activeElement;
  const fromKeys = e.clientX === 0 && e.clientY === 0;
  const anchor = fromKeys && opener instanceof HTMLElement ? opener.getBoundingClientRect() : null;
  const x0 = anchor ? anchor.left + 12 : e.clientX, y0 = anchor ? anchor.bottom : e.clientY;

  // самое вложенное, для чего есть действия
  let target: Element | null = null;
  let group: { title?: string; items: MenuItem[] } | null = null;
  for (const p of providers) {
    const el = t.closest?.(p.selector);
    if (!el || (target && !target.contains(el))) continue;
    const built = p.build(el, e);
    if (built?.items.length) { target = el; group = built; }
  }
  const items: MenuItem[] = [];
  const section = (list: MenuItem[]) => { if (!list.length) return; if (items.length) items.push('sep'); items.push(...list); };
  if (selected) section([{ label: 'Копировать', ic: 'copy', hint: 'Ctrl+C', action: () => copyText(selected) }]);
  if (group) section([...(group.title ? [{ heading: group.title }] : []), ...group.items]);
  if (link) section([
    { label: 'Открыть в новой вкладке', ic: 'external', action: () => window.open(link, '_blank', 'noopener') },
    { label: 'Скопировать адрес ссылки', ic: 'link', action: () => copyText(link, 'Адрес скопирован') },
  ]);
  section(pageBuild?.(e) ?? []);
  items.push({ foot: 'Меню браузера: Shift + правая кнопка' });

  const el = menuEl(items, 'Действия');
  document.body.append(el);
  // рамка — только у строки или карточки, не у всей карты
  const tr = target?.getBoundingClientRect();
  if (target && tr && tr.width * tr.height < innerWidth * innerHeight * 0.3) target.classList.add('ctx-target');
  menu = { el, sub: null, target, opener, at: performance.now() };
  const mw = el.offsetWidth, mh = el.offsetHeight;
  const left = x0 + mw + 8 > innerWidth ? Math.max(8, x0 - mw) : x0;
  const top = y0 + mh + 8 > innerHeight ? Math.max(8, Math.min(y0 - mh, innerHeight - mh - 8)) : y0;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.classList.toggle('from-right', left < x0);
  el.classList.toggle('from-bottom', top < y0);
  if (!fromKeys) ripples(x0, y0, { count: 2, size: 30, duration: 800 });
  (el.querySelector('.ctx-item:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true });
}
function startMenu() {
  const inMenus = (n: EventTarget | null) => !!menu && (menu.el.contains(n as Node) || !!menu.sub?.el.contains(n as Node));
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; if (menu && !inMenus(e.target)) closeMenu(false); }, true);
  document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey || lastPointer === 'touch' || lastPointer === 'pen') return;
    e.preventDefault();
    if ((e.target as Element)?.closest?.('.ctx-menu')) return;
    openMenu(e);
  });
  document.addEventListener('keydown', (e) => {
    if (!menu) return;
    const inSub = !!menu.sub?.el.contains(document.activeElement);
    const box = inSub ? menu.sub!.el : menu.el;
    const list = [...box.querySelectorAll<HTMLElement>('.ctx-item:not([disabled])')];
    const active = document.activeElement as HTMLElement | null;
    const i = active ? list.indexOf(active) : -1;
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && inSub)) {
      if (inSub) { const { parent } = menu.sub!; closeSub(); parent.focus({ preventScroll: true }); } else if (e.key === 'Escape') closeMenu();
    } else if (e.key === 'ArrowRight' && !inSub && active?.getAttribute('aria-haspopup')) active.click();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Tab') { closeMenu(false); return; } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener('blur', () => closeMenu(false));
  window.addEventListener('resize', () => closeMenu(false));
  window.addEventListener('scroll', () => menu && performance.now() - menu.at > 200 && closeMenu(false), { passive: true, capture: true });
}

// ---------- своё перетаскивание картинок и ссылок ----------
const LIFTABLE = 'img, a[href], a[data-href]';
const NO_LIFT = '.leaflet-container, .sat-snap, .sat-big, .ctx-menu, [draggable="true"]';
function startLift() {
  // браузер не рисует свою полупрозрачную копию
  document.addEventListener('dragstart', (e) => { if ((e.target as Element)?.closest?.(LIFTABLE)) e.preventDefault(); }, true);
  let pending: { el: HTMLElement; x: number; y: number } | null = null;
  let lift: { el: HTMLElement; ghost: HTMLElement; ox: number; oy: number; px: number; py: number; vx: number; tx: number; ty: number; raf: number; last: number; rect: DOMRect } | null = null;

  const begin = (p: NonNullable<typeof pending>, x: number, y: number) => {
    const { el } = p;
    const rect = el.getBoundingClientRect();
    let ghost: HTMLElement;
    if (el instanceof HTMLImageElement) {
      ghost = h('<div class="lift lift-img"></div>');
      const img = el.cloneNode(true) as HTMLImageElement;
      img.removeAttribute('class');
      ghost.append(img);
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
    } else {
      const info = linkInfo(el as HTMLAnchorElement);
      const title = info?.name || el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60) || info?.path || 'Ссылка';
      ghost = h(`<div class="lift lift-link">${icon('link')}<span><b>${esc(title)}</b><span>${esc(info?.path ?? '')}</span></span></div>`);
    }
    document.body.append(ghost);
    document.documentElement.classList.add('is-lifting');
    el.classList.add('is-lifted');
    floatState('is-grabbing', true);
    hideTip(); hideLink();
    const ox = el instanceof HTMLImageElement ? p.x - rect.left : -14, oy = el instanceof HTMLImageElement ? p.y - rect.top : -18;
    const px = el instanceof HTMLImageElement ? rect.left : x - ox, py = el instanceof HTMLImageElement ? rect.top : y - oy;
    lift = { el, ghost, ox, oy, px, py, vx: 0, tx: x - ox, ty: y - oy, raf: 0, last: 0, rect };
    ripples(x, y, { count: 1, size: 26, duration: 700 });
    const tick = (now: number) => {
      if (!lift) return;
      const dt = lift.last ? Math.min(0.05, (now - lift.last) / 1000) : 1 / 60;
      lift.last = now;
      const k = toward(18, dt);
      const nx = lift.px + (lift.tx - lift.px) * k, ny = lift.py + (lift.ty - lift.py) * k;
      lift.vx += ((nx - lift.px) / dt / 60 - lift.vx) * toward(12, dt);
      lift.px = nx; lift.py = ny;
      lift.ghost.style.transform = `translate3d(${nx}px, ${ny}px, 0) rotate(${clamp(lift.vx * 0.9, -14, 14)}deg) scale(1.06)`;
      lift.raf = requestAnimationFrame(tick);
    };
    lift.raf = requestAnimationFrame(tick);
  };
  const end = () => {
    if (!lift) return;
    const { el, ghost, rect, px, py, raf } = lift;
    cancelAnimationFrame(raf);
    lift = null;
    document.documentElement.classList.remove('is-lifting');
    floatState('is-grabbing', false);
    // пружиной на место; картинка — точно в свой прямоугольник, ссылка — к своему тексту
    const tx = el instanceof HTMLImageElement ? rect.left : rect.left + 4, ty = el instanceof HTMLImageElement ? rect.top : rect.top - 6;
    const anim = ghost.animate(
      [{ transform: ghost.style.transform, opacity: 1 }, { transform: `translate3d(${tx}px, ${ty}px, 0) rotate(0deg) scale(1)`, opacity: el instanceof HTMLImageElement ? 1 : 0 }],
      { duration: reduced() ? 0 : 460, easing: 'cubic-bezier(.34, 1.4, .64, 1)', fill: 'forwards' },
    );
    void px; void py;
    anim.onfinish = anim.oncancel = () => {
      ghost.remove();
      el.classList.remove('is-lifted');
      ripples(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 2, size: Math.max(34, rect.width * 0.7), duration: 900 });
    };
    // после переноса ссылка не открывается и кнопка с картинкой не нажимается
    const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 60);
    if (el.matches(LINK)) restoreHref(el as HTMLAnchorElement);
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = (e.target as Element)?.closest?.(LIFTABLE) as HTMLElement | null;
    if (!el || el.closest(NO_LIFT)) return;
    pending = { el, x: e.clientX, y: e.clientY };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (lift) { lift.tx = e.clientX - lift.ox; lift.ty = e.clientY - lift.oy; return; }
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) {
      const p = pending; pending = null;
      getSelection()?.removeAllRanges();
      begin(p, e.clientX, e.clientY);
    }
  }, { passive: true });
  const up = () => { pending = null; end(); };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', up);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lift) end(); });
}

// ---------- свой курсор ввода ----------
const FIELD = 'textarea, input:is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], :not([type]))';
const COPY = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
  'borderLeftWidth', 'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'textAlign'] as const;
function startCaret() {
  let caret: HTMLElement | null = null, mirror: HTMLElement | null = null, field: HTMLInputElement | HTMLTextAreaElement | null = null;
  let raf = 0, idle = 0, lastKey = 0;
  const make = () => {
    caret = h('<div class="ui-caret" aria-hidden="true"><i></i></div>');
    mirror = h('<div class="ui-caret-mirror" aria-hidden="true"></div>');
    document.body.append(caret, mirror);
  };
  const place = () => {
    raf = 0;
    if (!field || !caret || !mirror) return;
    const pos = field.selectionEnd;
    if (pos == null || field.selectionStart !== field.selectionEnd) { caret.classList.remove('is-on'); return; }
    const cs = getComputedStyle(field);
    for (const k of COPY) (mirror.style as unknown as Record<string, string>)[k] = cs[k];
    const area = field.tagName === 'TEXTAREA';
    mirror.style.whiteSpace = area ? 'pre-wrap' : 'pre';
    mirror.textContent = field.value.slice(0, pos);
    const mark = document.createElement('span');
    mark.textContent = '​';
    mirror.append(mark);
    const r = field.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const x = r.left + mark.offsetLeft - field.scrollLeft;
    const y = r.top + mark.offsetTop - field.scrollTop + (area ? 0 : (r.height - lh) / 2 - parseFloat(cs.paddingTop));
    if (x < r.left || x > r.right) { caret.classList.remove('is-on'); return; }
    caret.style.height = `${lh}px`;
    caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    caret.classList.add('is-on');
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element;
    if (!t?.matches?.(FIELD)) return;
    if (!caret) make();
    field = t as HTMLInputElement;
    field.classList.add('has-ui-caret');
    caret!.classList.add('is-appearing');
    window.setTimeout(() => caret?.classList.remove('is-appearing'), 360);
    schedule();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target !== field) return;
    field?.classList.remove('has-ui-caret');
    field = null;
    caret?.classList.remove('is-on');
  });
  // набор: курсор не мигает, от буквы по воде — маленький круг
  document.addEventListener('input', (e) => {
    if (e.target !== field || !caret) return;
    caret.classList.add('is-typing');
    window.clearTimeout(idle);
    idle = window.setTimeout(() => caret?.classList.remove('is-typing'), 650);
    schedule();
    const now = performance.now();
    if (now - lastKey > 70) {
      lastKey = now;
      requestAnimationFrame(() => {
        if (!caret) return;
        const r = caret.getBoundingClientRect();
        ripples(r.left + 1, r.bottom - 1, { count: 1, size: 12, duration: 650 });
      });
    }
  });
  document.addEventListener('selectionchange', () => field && schedule());
  document.addEventListener('keydown', (e) => { if (field && e.target === field) schedule(); });
  window.addEventListener('scroll', () => field && schedule(), { passive: true, capture: true });
  window.addEventListener('resize', () => field && schedule());
}

let started = false;
export function initUpkUi() {
  if (!ON || started) return;
  started = true;
  if (!fineMouse()) return;
  startTips();
  startLinks();
  startMenu();
  startLift();
  if (!reduced()) startCaret();
}
