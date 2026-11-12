import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { State } from '../types';
import type { MapHandle } from '../geo';
import type { Route } from '../route';
import MapShell, { type Insets } from './MapShell';
import SidePanel from './SidePanel';
import { ICONS, NAV, SoundToggle, ThemeSwitch } from './Nav';
import { MODE } from './TopBar';
import { showIntro } from '../introBus';
import { useTween } from '../motion';
import { HAZES, hazePicker, setHaze, useHaze } from './MapHaze';
import SatSnap from './SatSnap';
import { KIND_TITLE } from '../format';

const TZ = 'Europe/Astrakhan';
const dayFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' });
const hourFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const hmFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** «ночь на 13 ноября · 01:04» вечером и ночью, «13 ноября · 12:30» днём (время астраханское) */
function whenLabel(now: Date) {
  const h = Number(hourFmt.format(now));
  const night = h >= 17 || h < 7;
  const day = h >= 17 ? new Date(now.getTime() + 86_400_000) : now;
  return `${night ? 'ночь на ' : ''}${dayFmt.format(day)} · ${hmFmt.format(now)}`;
}

/** Ширина и высота окна: лист и отступы карты разные на телефоне и на компьютере */
function useViewport() {
  const [v, setV] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const on = () => setV({ w: innerWidth, h: innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/** Отступы под вырез и «домашнюю» полосу iPhone: шапка и лист выше на столько же — карта считает это */
function useSafeArea() {
  const [v, setV] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.append(el);
    const read = () => { const cs = getComputedStyle(el); setV({ top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 }); };
    read();
    window.addEventListener('resize', read);
    return () => { window.removeEventListener('resize', read); el.remove(); };
  }, []);
  return v;
}

type Snap = 'peek' | 'half' | 'tall';
const FOLD_KEY = '404-sheet-folded';
const readFold = () => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } };

const Play = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M6 4.2v11.6c0 .6.7 1 1.2.6l8.6-5.8a.75.75 0 0 0 0-1.2L7.2 3.6c-.5-.4-1.2 0-1.2.6z" /></svg>
);
const Reset = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.5v3.2h3.2" />
  </svg>
);

interface Props {
  state: State; online: boolean; route: Route; go: (r: Route) => void; badges: Partial<Record<Route, ReactNode>>;
  page: ReactNode; handle: MutableRefObject<MapHandle | null>; selected: string | null; onSelect: (id: string | null) => void;
  onDemo: () => void; onReset: () => void;
}

/**
 * Раскладка «Карта — всё»: живая дельта на весь экран — это и есть интерфейс. Сверху поверх карты —
 * место, время и состояние сети; слева — риск ночи крупной цифрой; справа — лист раздела (на карте —
 * журнал и тревога, в остальных разделах — сам раздел, шире); внизу — док разделов.
 * На телефоне лист выезжает снизу, ручка разворачивает его на весь экран.
 */
export default function DeltaShell({ state, online, route, go, badges, page, handle, selected, onSelect, onDemo, onReset }: Props) {
  const vp = useViewport();
  const phone = vp.w < 768;
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const safe = useSafeArea();
  // лист на телефоне: «peek» — только заголовок (карта почти вся), «half» — половина, «tall» — во весь экран.
  // Нажатие на ручку: половина ⇄ весь экран; ручку можно тянуть — лист встаёт на ближайшее положение.
  const [snap, setSnap] = useState<Snap>(route === 'map' ? 'half' : 'tall');
  useEffect(() => setSnap(route === 'map' ? 'half' : 'tall'), [route]);
  // на компьютере лист на карте можно свернуть к краю — карта целиком; выбор запоминается
  const [folded, setFolded] = useState(readFold);
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* только в этой вкладке */ } };
  const isFolded = folded && route === 'map' && !phone;

  // новая тревога: лист раскрывается, а если открыт другой раздел — сверху всплывает снимок места со спутника
  const known = useRef<Set<string> | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  useEffect(() => {
    const fresh = state.alerts.filter((a) => a.status === 'new');
    if (known.current) {
      const nu = fresh.find((a) => !known.current!.has(a.id));
      if (nu) {
        setFolded(false);
        setSnap((v) => (v === 'peek' ? 'half' : v));
        setPop(nu.id);
      }
    }
    known.current = new Set(state.alerts.map((a) => a.id));
  }, [state.alerts]);
  useEffect(() => { if (route === 'map') setPop(null); }, [route]);   // на карте тревога и так в листе
  const popAlert = pop ? state.alerts.find((a) => a.id === pop && a.status === 'new') : undefined;

  const m = online ? MODE[state.mode] : null;
  const risk = useTween(state.forecast.risk * 100, 1100);
  const peekH = 150 + safe.bottom;
  const insets: Insets = phone
    ? { top: 64 + safe.top, right: 0, bottom: snap === 'peek' ? peekH : Math.round(vp.h * 0.44), left: 0 }
    : { top: 76 + safe.top, right: isFolded ? 76 : 432, bottom: 92, left: vp.w >= 1180 ? 330 : 16 };
  const items = NAV.flatMap((s) => s.items);

  // ручку листа тянут пальцем: высота идёт за пальцем, на отпускании — ближайшее положение (с учётом броска)
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);
  const heights = () => ({ peek: peekH, half: vp.h * 0.44, tall: vp.h - 72 - safe.top });
  const onGrabDown = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!phone || !sheet.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheet.current.getBoundingClientRect().height, t: performance.now(), moved: false };
  };
  const onGrabMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current, el = sheet.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    const H = heights();
    el.style.transition = 'none';
    el.style.height = `${Math.max(H.peek - 30, Math.min(H.tall, d.h - dy))}px`;
  };
  const onGrabUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current, el = sheet.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = '';
    el.style.height = '';
    if (!d.moved) { setSnap(snap === 'tall' ? 'half' : 'tall'); return; }
    const H = heights();
    const v = (e.clientY - d.y) / Math.max(1, performance.now() - d.t);   // пикселей в мс, вниз — плюс
    const h = d.h - (e.clientY - d.y) - v * 220;                          // бросок докатывает лист
    const order: Snap[] = ['peek', 'half', 'tall'];
    setSnap(order.reduce((best, k) => (Math.abs(H[k] - h) < Math.abs(H[best] - h) ? k : best), 'half' as Snap));
  };

  return (
    <>
      <div className="absolute inset-0">
        <MapShell state={state} handle={handle} selected={selected} onSelect={onSelect} live insets={insets} />
      </div>
      <div className="delta-scrim" aria-hidden />

      <header className="delta-head" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <button type="button" onClick={showIntro} title="Показать интро" aria-label="Показать интро" className="shrink-0">
          <img src="/brand/404-logo-cream.svg" alt="404" className="on-night h-8 w-auto" />
          <img src="/brand/404-logo-dark.svg" alt="404" className="on-day h-8 w-auto" />
        </button>
        <div className="hidden min-w-0 min-[480px]:block">
          <div className="truncate text-[16px] font-semibold leading-5 tracking-[-.01em]">Дельта Волги</div>
          <div className="truncate text-[12.5px] leading-[17px] text-muted">{whenLabel(now)}</div>
        </div>
        <span className="flex-1" />
        <div className="delta-status lit" role="status" aria-live="polite" title={m ? `${m.label} — ${m.hint}` : 'Нет связи с сервером'}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${m ? `${state.mode === 'alarm' || state.mode === 'intercept' ? 'ping-dot' : 'live-dot'} ${m.dot}` : 'animate-pulse bg-grey'}`} />
          <span className={`truncate font-semibold ${state.mode === 'alarm' || state.mode === 'intercept' ? 'text-alert' : ''}`}>{m ? m.label : 'Нет связи'}</span>
          {m && <span className="hidden truncate text-muted xl:inline">{m.hint}</span>}
        </div>
        <span className="hidden items-center gap-1 lg:flex">
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm text-muted hover:text-primary" onClick={onDemo} title="Для показа: прогон сценария тревоги"><Play />Демо</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm text-muted hover:text-primary" onClick={onReset} title="Вернуть демо в начало"><Reset />Сбросить</button>
        </span>
        <span className="lg:hidden">
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm !w-8 !px-0 text-muted hover:text-primary" onClick={onDemo} title="Запустить демо" aria-label="Запустить демо"><Play /></button>
        </span>
        <ThemeSwitch compact always />
        <SoundToggle always />
      </header>

      {route === 'map' && !phone && (
        <section className="delta-risk" aria-label="Риск этой ночью">
          <div className="cap">Риск этой ночью{state.forecast.demo ? ' · демо' : ''}</div>
          <div className="delta-risk-num">{Math.round(risk)}<span>&nbsp;%</span></div>
          <p className="delta-risk-text">{state.forecast.message}</p>
          <div className="delta-risk-bar" aria-hidden><span style={{ width: `${Math.round(risk)}%` }} /></div>
        </section>
      )}

      <section ref={sheet} className={`delta-sheet lit ${route === 'map' ? '' : 'is-wide'} ${snap === 'tall' ? 'is-tall' : snap === 'peek' ? 'is-peek' : ''} ${isFolded ? 'is-folded' : ''}`}
        aria-label="Раздел" aria-hidden={isFolded || undefined}>
        <button type="button" className="delta-grab" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp} onPointerCancel={onGrabUp}
          aria-label={snap === 'tall' ? 'Показать карту' : 'Развернуть'} aria-expanded={snap === 'tall'}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSnap(snap === 'tall' ? 'half' : 'tall'); } }}>
          <span />
        </button>
        <div key={route} className="delta-sheet-body page-in">
          {route === 'map' ? <SidePanel state={state} handle={handle} selected={selected} onSelect={onSelect} /> : page}
        </div>
      </section>

      {/* свернуть лист к краю — вся карта видна; вернуть — та же кнопка */}
      {route === 'map' && !phone && (
        <button type="button" className={`delta-fold lit ${isFolded ? 'is-folded' : ''}`} onClick={() => fold(!isFolded)}
          aria-label={isFolded ? 'Показать журнал' : 'Свернуть журнал — вся карта'} title={isFolded ? 'Показать журнал' : 'Свернуть журнал — вся карта'}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={isFolded ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
          </svg>
          {isFolded && state.alerts.some((a) => a.status !== 'resolved') && <span className="delta-fold-dot" />}
        </button>
      )}

      {/* тревога, пока открыт другой раздел: снимок места со спутника всплывает сразу */}
      {popAlert && route !== 'map' && (
        <aside className="delta-pop lit" role="alert" key={popAlert.id}>
          <div className="delta-pop-head">
            <span className="ping-dot h-2 w-2 shrink-0 rounded-full bg-alert" />
            <span className="min-w-0 flex-1 truncate font-semibold">{KIND_TITLE[popAlert.kind]} у буя {popAlert.buoy_name}</span>
            <button type="button" onClick={() => setPop(null)} aria-label="Скрыть" title="Скрыть" className="-mr-1 grid h-8 w-8 place-items-center rounded-full text-muted hover:text-primary">✕</button>
          </div>
          <SatSnap lat={popAlert.lat} lon={popAlert.lon} height={phone ? 150 : 180} title={`${KIND_TITLE[popAlert.kind]} у буя ${popAlert.buoy_name}`} tone={popAlert.kind === 'silence' ? 'warn' : 'alert'} />
          <button type="button" className="ui-btn ui-btn-danger mt-3 w-full bg-alert text-bg" onClick={() => { setPop(null); go('map'); }}>Открыть тревогу</button>
        </aside>
      )}

      {hazePicker && route === 'map' && <HazePicker />}

      <nav aria-label="Разделы" className="delta-dock lit">
        {items.map((it) => (
          <button key={it.id} type="button" onClick={() => go(it.id)} aria-current={route === it.id ? 'page' : undefined} title={it.label}
            className="delta-dock-item">
            <span className="relative">{ICONS[it.id]}
              {badges[it.id] != null && <span className="absolute -right-2.5 -top-2">{badges[it.id]}</span>}
            </span>
            <span>{it.short}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

/** Переключатель вариантов дымки — для выбора (виден при ?haze в адресе) */
function HazePicker() {
  const v = useHaze();
  return (
    <div className="delta-haze lit" role="radiogroup" aria-label="Вариант дымки">
      <span className="px-2 text-[12.5px] text-muted">Дымка</span>
      {HAZES.map((h) => (
        <button key={h.id} type="button" role="radio" aria-checked={v === h.id} onClick={() => setHaze(h.id)}>{h.id} · {h.name}</button>
      ))}
      <button type="button" role="radio" aria-checked={v === 0} onClick={() => setHaze(0)}>без</button>
    </div>
  );
}
