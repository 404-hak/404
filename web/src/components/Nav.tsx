import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Route } from '../route';
import { setSound, useSoundOn } from '../sound';

const I = ({ children }: { children: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
export const ICONS: Record<Route, ReactNode> = {
  map: <I><path d="M2.5 5.5 7 3.5l6 2 4.5-2v11l-4.5 2-6-2-4.5 2z" /><path d="M7 3.5v11M13 5.5v11" /></I>,
  alerts: <I><path d="M5 8a5 5 0 0 1 10 0c0 4.5 1.8 5.5 1.8 5.5H3.2S5 12.5 5 8z" /><path d="M8.3 16.5a1.8 1.8 0 0 0 3.4 0" /></I>,
  stats: <I><path d="M3 16.5h14" /><rect x="4.5" y="9" width="2.5" height="5" rx=".6" /><rect x="8.75" y="5" width="2.5" height="9" rx=".6" /><rect x="13" y="7" width="2.5" height="7" rx=".6" /></I>,
  forecast: <I><path d="M15.5 12.4A6.5 6.5 0 0 1 7.6 3.5a6.5 6.5 0 1 0 7.9 8.9z" /></I>,
  buoys: <I><circle cx="10" cy="10" r="2.2" /><path d="M5.8 5.8a6 6 0 0 0 0 8.4M14.2 5.8a6 6 0 0 1 0 8.4M3.3 3.3a9.5 9.5 0 0 0 0 13.4M16.7 3.3a9.5 9.5 0 0 1 0 13.4" /></I>,
  evidence: <I><rect x="3" y="7.5" width="6" height="5" rx="1.6" /><rect x="11" y="7.5" width="6" height="5" rx="1.6" /><path d="M9 10h2" /></I>,
};

export const NAV: { group: string; items: { id: Route; label: string; short: string }[] }[] = [
  { group: 'Дежурство', items: [{ id: 'map', label: 'Обстановка', short: 'Карта' }, { id: 'alerts', label: 'Тревоги', short: 'Тревоги' }] },
  { group: 'Аналитика', items: [{ id: 'stats', label: 'Статистика', short: 'Анализ' }, { id: 'forecast', label: 'Прогноз ночей', short: 'Прогноз' }] },
  { group: 'Сеть', items: [{ id: 'buoys', label: 'Буи', short: 'Буи' }, { id: 'evidence', label: 'Доказательства', short: 'Улики' }] },
];

const SoundIcon = ({ on }: { on: boolean }) => (
  <I>
    <path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" />
    {on ? <path d="M13.5 7a4 4 0 0 1 0 6M15.6 5a7 7 0 0 1 0 10" /> : <path d="m13.5 8 4 4M17.5 8l-4 4" />}
  </I>
);

interface Props { route: Route; go: (r: Route) => void; badges: Partial<Record<Route, ReactNode>> }

/** Боковая навигация: полная на широком экране, колонка значков на среднем. */
export function Sidebar({ route, go, badges }: Props) {
  const sound = useSoundOn();
  const refs = useRef<Partial<Record<Route, HTMLButtonElement | null>>>({});
  const [mark, setMark] = useState({ y: 0, h: 0 });
  useLayoutEffect(() => {
    const el = refs.current[route];
    if (el && (el.offsetTop !== mark.y || el.offsetHeight !== mark.h)) setMark({ y: el.offsetTop, h: el.offsetHeight });
  });
  return (
    <nav aria-label="Разделы" className="relative z-20 hidden w-[68px] shrink-0 flex-col border-r border-line bg-surface/70 backdrop-blur md:flex xl:w-[232px]">
      <div className="flex h-14 items-center px-5">
        <img src="/brand/404-lockup-horizontal-cream.svg" alt="404" className="hidden h-[18px] xl:block" />
        <img src="/brand/404-logo-cream.svg" alt="404" className="-ml-0.5 h-7 xl:hidden" />
      </div>
      <div className="relative flex-1 px-3 pt-3">
        {/* светлая плашка переезжает к выбранному разделу */}
        <span aria-hidden className="absolute left-3 right-3 rounded-[10px] border border-white/10 bg-white/[.07] transition-[transform,height] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
          style={{ transform: `translateY(${mark.y}px)`, height: mark.h, top: 0 }} />
        {NAV.map((sec, si) => (
          <div key={sec.group} className="mb-4">
            <div className="cap mb-1.5 hidden px-3 xl:block">{sec.group}</div>
            <div className="mx-auto mb-2 h-px w-6 bg-line xl:hidden" />
            {sec.items.map((it, ii) => (
              <button key={it.id} ref={(el) => { refs.current[it.id] = el; }} type="button" onClick={() => go(it.id)}
                title={it.label} aria-current={route === it.id ? 'page' : undefined} style={{ ['--i' as string]: si * 2 + ii }}
                className={`nav-in relative flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium ${route === it.id ? 'text-primary' : 'text-muted hover:text-primary'}`}>
                <span className={`shrink-0 transition-transform duration-500 ease-[var(--spring-soft)] ${route === it.id ? 'scale-110' : ''}`}>{ICONS[it.id]}</span>
                <span className="hidden flex-1 text-left xl:block">{it.label}</span>
                {badges[it.id] != null && (
                  <span className="absolute right-1.5 top-1 xl:static">{badges[it.id]}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <button type="button" onClick={() => setSound(!sound)} aria-pressed={sound} title={sound ? 'Выключить звук' : 'Включить звук'}
          className="flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[13px] text-muted hover:bg-white/5 hover:text-primary">
          <SoundIcon on={sound} /><span className="hidden xl:block">{sound ? 'Звук включён' : 'Звук выключен'}</span>
        </button>
      </div>
    </nav>
  );
}

/** Нижняя панель разделов на телефоне. */
export function BottomNav({ route, go, badges }: Props) {
  return (
    <nav aria-label="Разделы" className="relative z-20 grid shrink-0 grid-cols-6 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {NAV.flatMap((s) => s.items).map((it) => (
        <button key={it.id} type="button" onClick={() => go(it.id)} aria-current={route === it.id ? 'page' : undefined}
          className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${route === it.id ? 'text-primary' : 'text-muted'}`}>
          <span className={`transition-transform duration-300 ${route === it.id ? '-translate-y-0.5' : ''}`}>{ICONS[it.id]}</span>
          {it.short}
          {route === it.id && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" />}
          {badges[it.id] != null && <span className="absolute right-2.5 top-1.5">{badges[it.id]}</span>}
        </button>
      ))}
    </nav>
  );
}

export const SoundToggle = () => {
  const on = useSoundOn();
  return (
    <button type="button" onClick={() => setSound(!on)} aria-pressed={on} title={on ? 'Выключить звук' : 'Включить звук'}
      className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-primary md:hidden">
      <SoundIcon on={on} />
    </button>
  );
};
