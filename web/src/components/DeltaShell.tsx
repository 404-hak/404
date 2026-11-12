import { useEffect, useState, type MutableRefObject, type ReactNode } from 'react';
import type { State } from '../types';
import type { MapHandle } from '../geo';
import type { Route } from '../route';
import MapShell, { type Insets } from './MapShell';
import SidePanel from './SidePanel';
import { ICONS, NAV, SoundToggle, ThemeSwitch } from './Nav';
import { MODE } from './TopBar';
import { showIntro } from '../introBus';
import { useTween } from '../motion';

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
  // ручка листа на телефоне: карта — лист внизу, разделы — во весь экран; нажатие меняет местами
  const [flip, setFlip] = useState(false);
  useEffect(() => setFlip(false), [route]);
  const tall = (route !== 'map') !== flip;

  const m = online ? MODE[state.mode] : null;
  const risk = useTween(state.forecast.risk * 100, 1100);
  const insets: Insets = phone
    ? { top: 64, right: 0, bottom: Math.round(vp.h * 0.44), left: 0 }
    : { top: 76, right: 432, bottom: 92, left: vp.w >= 1180 ? 330 : 16 };
  const items = NAV.flatMap((s) => s.items);

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

      <section className={`delta-sheet lit ${route === 'map' ? '' : 'is-wide'} ${tall ? 'is-tall' : ''}`} aria-label="Раздел">
        <button type="button" className="delta-grab" onClick={() => setFlip(!flip)} aria-label={tall ? 'Показать карту' : 'Развернуть'} aria-expanded={tall}>
          <span />
        </button>
        <div key={route} className="delta-sheet-body page-in">
          {route === 'map' ? <SidePanel state={state} handle={handle} selected={selected} onSelect={onSelect} /> : page}
        </div>
      </section>

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
