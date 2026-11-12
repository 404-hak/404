import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Alert, Buoy, Forecast, State } from '../types';
import { KIND_TITLE, coord, fmtDM, fmtHM, fmtTime, isToday, km, pct, plural, shortHash } from '../format';
import { BUOY_STATUS, sectorCenter, type MapHandle, type Selection } from '../geo';
import { api } from '../live';
import { useTween } from '../motion';
import Moon from './Moon';

type Handle = MutableRefObject<MapHandle | null>;

const LEVEL = {
  low: { word: 'низкий', text: 'text-accent', tip: '#7A866F' },
  elevated: { word: 'повышенный', text: 'text-warn', tip: '#F59E0B' },
  high: { word: 'высокий', text: 'text-warn', tip: '#F59E0B' },
} as const;

/** Звук услышан: живой эквалайзер. */
const Eq = () => <span className="eq" aria-hidden><i /><i /><i /><i /></span>;

const Stat = ({ label, value, icon, tone = '' }: { label: string; value: string; icon?: ReactNode; tone?: string }) => (
  <div className="rounded-[10px] border border-line bg-white/[.02] px-2.5 py-2 transition-colors hover:border-white/25 hover:bg-white/[.04]">
    <div className="flex items-center justify-between gap-1 text-[11px] leading-4 text-muted">{label}{icon}</div>
    <div className={`mt-0.5 font-mono text-[14px] font-medium leading-5 ${tone}`}>{value}</div>
  </div>
);

const Wave = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <path d="M1.5 6c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4 0M1.5 10.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4 0" />
  </svg>
);
const Wind = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <path d="M1.5 6h8.5a2 2 0 1 0-2-2M1.5 10h11a2 2 0 1 1-2 2M1.5 8h5" />
  </svg>
);

/** Шкала риска: от шалфея к янтарю и коралловому, пороги 40 % и 70 %, кончик светится. */
function RiskBar({ value, tip }: { value: number; tip: string }) {
  const v = Math.max(0, Math.min(100, value));
  const grad = 'linear-gradient(90deg, #7A866F 0%, #A39A5E 30%, #F59E0B 62%, #EF4444 100%)';
  return (
    <div>
      <div className="relative h-1.5 rounded-full">
        <div className="absolute inset-0 rounded-full opacity-20" style={{ background: grad }} />
        <div className="absolute inset-0 rounded-full" style={{ background: grad, clipPath: `inset(0 ${100 - v}% 0 0 round 999px)` }} />
        {[40, 70].map((t) => <span key={t} className="absolute -bottom-1 -top-1 w-px bg-bg/80" style={{ left: `${t}%` }} />)}
        <span className="risk-tip absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg"
          style={{ left: `${v}%`, background: tip, ['--tip' as string]: tip }} />
      </div>
      <div className="mt-2 grid grid-cols-[40fr_30fr_30fr] text-[10px] uppercase tracking-[.08em] text-muted">
        <span>низкий</span><span>повышенный</span><span>высокий</span>
      </div>
    </div>
  );
}

function ForecastCard({ f, state, handle }: { f: Forecast; state: State; handle: Handle }) {
  const lv = LEVEL[f.level];
  const risk = useTween(f.risk * 100, 1100);
  const hot = state.sectors.filter((s) => f.hot_sectors.includes(s.n));
  return (
    <section className="enter border-b border-line p-5">
      <div className="cap">Риск браконьерства этой ночью{f.demo ? ' · демо' : ''}</div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className={`font-light tabular-nums text-[56px] leading-[60px] tracking-[-.03em] transition-colors duration-700 ${lv.text}`}>
          {Math.round(risk)}<span className="text-[32px] tracking-normal">&nbsp;%</span>
        </span>
        <span key={f.level} className={`enter text-[14px] font-semibold ${lv.text}`}>{lv.word}</span>
      </div>
      <div className="mt-3"><RiskBar value={risk} tip={lv.tip} /></div>
      <p key={f.message} className="fade-in mt-4 text-[14px] leading-[21px]">{f.message}</p>
      {hot.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">Показать на карте:</span>
          {hot.map((s, i) => (
            <button key={s.n} type="button" onClick={() => handle.current?.flyTo(...sectorCenter(s), 11)} style={{ animationDelay: `${200 + i * 80}ms` }}
              className="enter h-7 rounded-chip border border-warn/50 bg-warn/10 px-2.5 text-[12px] font-medium text-warn hover:border-warn hover:bg-warn/20">
              сектор {s.n} →
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="луна" value={pct(f.moon_illumination)} icon={<Moon illumination={f.moon_illumination} phase={f.moon_phase} size={16} />} />
        <Stat label="вода" value={`${f.water_temp > 0 ? '+' : ''}${Math.round(f.water_temp)}°`} icon={<Wave />} />
        <Stat label="ветер" value={`${f.wind_ms} м/с`} icon={<Wind />} />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted">{f.moon_phase}, {f.weekday}. Чем темнее ночь и теплее вода, тем выше риск.</p>
    </section>
  );
}

function AlertCard({ a, handle }: { a: Alert; handle: Handle }) {
  const intercept = a.status === 'intercept';
  return (
    <section className="alert-flash border-b border-alert/30 p-5">
      <div className="enter flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-alert">
          <span className="live-dot h-2 w-2 rounded-full bg-alert" />{intercept ? 'Перехват — катер в пути' : 'Тревога — нужно ваше решение'}
        </div>
        <span className="font-mono text-[11px] text-muted">{fmtTime(a.ts)}</span>
      </div>
      <h2 className="enter mt-3 flex items-center gap-2.5 text-[19px] font-semibold leading-[24px] text-primary" style={{ animationDelay: '60ms' }}>
        <span className="text-alert"><Eq /></span>{KIND_TITLE[a.kind]} у буя {a.buoy_name}
      </h2>
      <p className="enter mt-2 text-[14px] leading-[21px] text-primary/90" style={{ animationDelay: '120ms' }}>{a.message}</p>

      <div className="enter mt-4 grid grid-cols-3 gap-2" style={{ animationDelay: '180ms' }}>
        <Stat label="от вас" value={a.distance_km != null ? km(a.distance_km) : '—'} tone="text-primary" />
        <Stat label="уверенность" value={pct(a.confidence)} />
        <Stat label="сектор" value={String(a.sector)} />
      </div>
      {a.match && (
        <p className="enter mt-3 text-[12px] leading-[17px] text-muted" style={{ animationDelay: '220ms' }}>
          Звук мотора совпал с катером <span className="font-mono text-primary">{a.match.vessel_id}</span> на {pct(a.match.similarity)}
        </p>
      )}

      <div className="enter mt-5 flex gap-2" style={{ animationDelay: '260ms' }}>
        {!intercept && (
          <button type="button" onClick={() => api.setAlertStatus(a.id, 'intercept')}
            className="h-10 flex-1 rounded-[9px] bg-alert text-[13px] font-semibold text-bg shadow-[0_6px_22px_-6px_rgba(239,68,68,.75)] hover:bg-[#F25555] hover:shadow-[0_8px_28px_-6px_rgba(239,68,68,.95)]">
            Начать перехват
          </button>
        )}
        <button type="button" className="h-10 flex-1 rounded-[9px] border border-line text-[13px] font-semibold hover:border-grey hover:bg-white/[.04]"
          onClick={() => api.setAlertStatus(a.id, 'resolved')}>
          {intercept ? 'Задержан — закрыть' : 'Ложная тревога'}
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[10px] text-muted">
        <button type="button" className="hover:text-primary" onClick={() => handle.current?.flyTo(a.lat, a.lon)}>{coord(a.lat, a.lon)}</button>
        <span title={`Запись в цепочке SHA-256: ${a.hash}`}>запись {shortHash(a.hash)}</span>
      </div>
    </section>
  );
}

const ago = (iso: string, now: string) => {
  const s = Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 1000));
  return s < 15 ? 'только что' : s < 60 ? `${s} с назад` : s < 3600 ? `${Math.round(s / 60)} мин назад` : `${Math.round(s / 3600)} ч назад`;
};

/** Карточка выбранного буя: состояние, связь, его события. */
function BuoyCard({ b, state, handle, onClose, alert }: { b: Buoy; state: State; handle: Handle; onClose: () => void; alert?: Alert }) {
  const events = state.alerts.filter((a) => a.buoy_id === b.id);
  const tone = { ok: 'text-accent', warn: 'text-warn', alert: 'text-alert', offline: 'text-grey' }[b.status];
  return (
    <section className="enter border-b border-line">
      {alert && (
        <button type="button" onClick={onClose}
          className="flex w-full items-center gap-2 bg-alert/15 px-5 py-2 text-left text-[12px] font-medium text-alert hover:bg-alert/25">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-alert" />Тревога у буя {alert.buoy_name} — вернуться к ней
        </button>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] ${RING[b.status]}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${BAR[b.status]}`} />
            </span>
            <div>
              <div className="cap">Акустический буй</div>
              <h2 className="text-[19px] font-semibold leading-[24px]">{b.name}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Снять выделение" title="Снять выделение (Esc)"
            className="-mr-1 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-primary">✕</button>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          <span className={`font-semibold ${tone}`}>{BUOY_STATUS[b.status]}</span> · сектор {b.sector} · на связи {ago(b.last_seen, state.now)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="батарея" value={`${b.battery}\u00a0%`} tone={b.battery < 30 ? 'text-warn' : ''} />
          <Stat label="сигнал" value={pct(b.health)} icon={<Signal health={b.health} status={b.status} />} />
          <Stat label="событий" value={String(events.length)} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => handle.current?.flyTo(b.lat, b.lon, 12)}
            className="h-9 rounded-[9px] border border-line px-3 text-[12px] font-semibold hover:border-grey hover:bg-white/[.04]">Показать на карте</button>
          <span className="font-mono text-[10px] text-muted">{coord(b.lat, b.lon)}</span>
        </div>
        {events.length > 0 && (
          <ul className="mt-4 border-t border-line">
            {events.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 border-b border-line py-2 text-[12px]">
                <span><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${KIND_DOT[a.kind]}`} />{KIND_TITLE[a.kind]}
                  <span className="text-muted"> · {STATUS[a.status]}</span></span>
                <span className="font-mono text-[11px] text-muted">{isToday(a.ts, state.now) ? fmtHM(a.ts) : fmtDM(a.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const KIND_DOT = { motor: 'bg-alert', shot: 'bg-alert', silence: 'bg-warn', offline: 'bg-grey' } as const;
const STATUS = { new: 'ждёт решения', intercept: 'перехват', resolved: 'закрыт' } as const;

/** Задержка появления строк: лесенкой при первом показе, без задержки для новых. */
function useStagger() {
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  return (i: number) => (first.current ? { animationDelay: `${Math.min(i, 12) * 45}ms` } : undefined);
}

function EventFeed({ state, handle }: { state: State; handle: Handle }) {
  const delay = useStagger();
  if (!state.alerts.length) return <p className="px-5 py-4 text-[13px] text-muted">Событий пока не было.</p>;
  return (
    <ul className="px-5">
      {state.alerts.map((a, i) => (
        <li key={a.id} className={a.status === 'resolved' ? 'row-in' : 'row-hot'} style={delay(i)}>
          <button type="button" onClick={() => handle.current?.flyTo(a.lat, a.lon)}
            className="grid w-full grid-cols-[52px_1fr] gap-2 border-b border-line py-2.5 text-left text-[13px] leading-[18px] hover:bg-white/[.03]">
            <span className="font-mono text-[11px] leading-[18px] text-muted">{isToday(a.ts, state.now) ? fmtHM(a.ts) : fmtDM(a.ts)}</span>
            <span>
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle ${KIND_DOT[a.kind]}`} />
              <span className="font-medium">{KIND_TITLE[a.kind]}</span>
              <span className="text-muted"> · {a.buoy_name}</span>
              <span className={`block text-[12px] ${a.status === 'resolved' ? 'text-muted' : 'text-alert'}`}>{STATUS[a.status]}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const RING = { ok: 'border-accent', warn: 'border-warn', alert: 'border-alert', offline: 'border-grey' } as const;
const BAR = { ok: 'bg-accent', warn: 'bg-warn', alert: 'bg-alert', offline: 'bg-grey' } as const;
const ORDER = { alert: 0, warn: 1, offline: 2, ok: 3 } as const;

/** Качество сигнала буя — четыре палочки, как у телефона. */
const Signal = ({ health, status }: { health: number; status: Buoy['status'] }) => {
  const n = status === 'offline' ? 0 : Math.max(1, Math.round(health * 4));
  return (
    <span className="flex h-3 items-end gap-[2px]" title={`Здоровье ${pct(health)}`} aria-label={`Здоровье ${pct(health)}`}>
      {[1, 2, 3, 4].map((k) => (
        <span key={k} className={`w-[3px] rounded-[1px] transition-colors duration-500 ${k <= n ? BAR[status] : 'bg-white/15'}`} style={{ height: `${k * 25}%` }} />
      ))}
    </span>
  );
};

function BuoyList({ buoys, handle, selected, onSelect }: { buoys: Buoy[]; handle: Handle } & Selection) {
  const delay = useStagger();
  const sorted = [...buoys].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.sector - b.sector);
  return (
    <ul className="px-5">
      {sorted.map((b, i) => (
        <li key={b.id} className="row-in" style={delay(i)}>
          <button type="button" onClick={() => { onSelect(b.id); handle.current?.flyTo(b.lat, b.lon, 12); }} aria-pressed={b.id === selected}
            className={`group grid w-full grid-cols-[18px_1fr_auto_auto] items-center gap-3 border-b border-line py-2.5 text-left text-[13px] leading-[18px] hover:bg-white/[.03] ${b.id === selected ? 'bg-white/[.06]' : ''}`}>
            <span className={`relative h-3.5 w-3.5 rounded-full border-[2.5px] transition-transform group-hover:scale-125 ${RING[b.status]} ${b.status === 'alert' ? 'live-dot bg-alert' : ''}`} />
            <span>
              <span className="font-medium">{b.name}</span>
              <span className="block text-[12px] text-muted">сектор {b.sector} · {BUOY_STATUS[b.status]}</span>
            </span>
            <Signal health={b.health} status={b.status} />
            <span className={`w-9 text-right font-mono text-[11px] ${b.battery < 30 ? 'text-warn' : 'text-muted'}`} title="Заряд батареи">{`${b.battery} %`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Вкладки с подчёркиванием, которое переезжает к выбранной. */
function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [bar, setBar] = useState({ x: 0, w: 0 });
  // ширина вкладки меняется (счётчик событий), поэтому меряем после каждой отрисовки
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el && (el.offsetLeft !== bar.x || el.offsetWidth !== bar.w)) setBar({ x: el.offsetLeft, w: el.offsetWidth });
  });
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-5 backdrop-blur" role="tablist">
      <div className="relative flex gap-5">
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" aria-selected={t.id === value}
            onClick={() => onChange(t.id)}
            className={`h-11 text-[13px] font-medium ${t.id === value ? 'text-primary' : 'text-muted hover:text-primary'}`}>
            {t.label}
          </button>
        ))}
        <span className="absolute -bottom-px left-0 h-0.5 rounded-full bg-primary transition-[transform,width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ width: bar.w, transform: `translateX(${bar.x}px)` }} />
      </div>
    </div>
  );
}

export default function SidePanel({ state, handle, selected, onSelect }: { state: State; handle: Handle } & Selection) {
  const [tab, setTab] = useState<'events' | 'buoys'>('events');
  const active = state.alerts.find((a) => a.status === 'intercept') ?? state.alerts.find((a) => a.status === 'new');
  const online = state.buoys.filter((b) => b.status !== 'offline').length;
  const health = state.buoys.reduce((s, b) => s + b.health, 0) / (state.buoys.length || 1);
  const open = state.alerts.filter((a) => a.status !== 'resolved').length;
  const buoy = state.buoys.find((b) => b.id === selected);
  // выбрали буй — карточка сверху должна быть видна
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selected]);
  return (
    <aside className="panel flex min-h-0 flex-1 flex-col border-line md:w-[380px] md:flex-none md:shrink-0 md:border-l">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {buoy
          ? <BuoyCard key={buoy.id} b={buoy} state={state} handle={handle} alert={active} onClose={() => onSelect(null)} />
          : active
            ? <AlertCard key={`${active.id}-${active.status}`} a={active} handle={handle} />
            : <ForecastCard key="forecast" f={state.forecast} state={state} handle={handle} />}
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'events', label: <>Журнал событий{open > 0 && <span className="ml-1.5 rounded-full bg-alert px-1.5 py-px font-mono text-[10px] text-bg">{open}</span>}</> },
          { id: 'buoys', label: <>Буи <span className="font-mono text-[11px] text-muted">{online}/{state.buoys.length}</span></> },
        ]} />
        {tab === 'events' ? <EventFeed key="events" state={state} handle={handle} /> : (
          <div key="buoys" className="fade-in">
            <p className="px-5 pt-3 text-[12px] leading-[17px] text-muted">
              На связи {plural(online, ['буй', 'буя', 'буёв'])} из {state.buoys.length} · здоровье сети {pct(health)}. Нажмите на буй — карта покажет его.
            </p>
            <BuoyList buoys={state.buoys} handle={handle} selected={selected} onSelect={onSelect} />
          </div>
        )}
      </div>
    </aside>
  );
}
