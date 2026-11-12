import { useState, type MutableRefObject } from 'react';
import type { Alert, Buoy, Forecast, State } from '../types';
import { KIND_TITLE, coord, fmtDM, fmtHM, fmtTime, isToday, km, pct, plural, shortHash } from '../format';
import { BUOY_STATUS, sectorCenter, type MapHandle } from '../geo';
import { api } from '../live';

type Handle = MutableRefObject<MapHandle | null>;

const LEVEL = {
  low: { word: 'низкий', text: 'text-accent', bar: 'bg-accent' },
  elevated: { word: 'повышенный', text: 'text-warn', bar: 'bg-warn' },
  high: { word: 'высокий', text: 'text-warn', bar: 'bg-warn' },
} as const;

function AlertCard({ a, handle }: { a: Alert; handle: Handle }) {
  const intercept = a.status === 'intercept';
  return (
    <section className="border-b border-line bg-alert/[.06] p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-alert">
          <span className="h-2 w-2 animate-pulse rounded-full bg-alert" />{intercept ? 'Перехват — катер в пути' : 'Тревога — нужно ваше решение'}
        </div>
        <span className="font-mono text-[11px] text-muted">{fmtTime(a.ts)}</span>
      </div>
      <h2 className="mt-3 text-[18px] font-semibold leading-[23px]">{KIND_TITLE[a.kind]} у буя {a.buoy_name}</h2>
      <p className="mt-2 text-[14px] leading-[21px] text-primary/90">{a.message}</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="от вас" value={a.distance_km != null ? km(a.distance_km) : '—'} />
        <Stat label="уверенность" value={pct(a.confidence)} />
        <Stat label="сектор" value={String(a.sector)} />
      </div>
      {a.match && (
        <p className="mt-3 text-[12px] leading-[17px] text-muted">
          Звук мотора совпал с катером <span className="font-mono text-primary">{a.match.vessel_id}</span> на {pct(a.match.similarity)}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        {!intercept && (
          <button type="button" className="h-10 flex-1 rounded-[9px] bg-alert text-[13px] font-semibold text-bg hover:bg-alert/90"
            onClick={() => api.setAlertStatus(a.id, 'intercept')}>
            Начать перехват
          </button>
        )}
        <button type="button" className="h-10 flex-1 rounded-[9px] border border-line text-[13px] font-semibold hover:border-grey"
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

const Stat = ({ label, value, tone = '' }: { label: string; value: string; tone?: string }) => (
  <div className="rounded-[9px] border border-line px-2.5 py-2">
    <div className="text-[11px] leading-4 text-muted">{label}</div>
    <div className={`mt-0.5 font-mono text-[14px] font-medium leading-5 ${tone}`}>{value}</div>
  </div>
);

function ForecastCard({ f, state, handle }: { f: Forecast; state: State; handle: Handle }) {
  const lv = LEVEL[f.level];
  const hot = state.sectors.filter((s) => f.hot_sectors.includes(s.n));
  return (
    <section className="border-b border-line p-5">
      <div className="cap">Риск браконьерства этой ночью{f.demo ? ' · демо' : ''}</div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className={`text-[52px] font-light leading-[56px] tracking-[-.02em] ${lv.text}`}>{pct(f.risk)}</span>
        <span className={`text-[14px] font-semibold ${lv.text}`}>{lv.word}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${lv.bar}`} style={{ width: `${Math.round(f.risk * 100)}%` }} />
      </div>
      <p className="mt-4 text-[14px] leading-[21px]">{f.message}</p>
      {hot.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">Показать на карте:</span>
          {hot.map((s) => (
            <button key={s.n} type="button" onClick={() => handle.current?.flyTo(...sectorCenter(s), 11)}
              className="h-7 rounded-chip border border-warn/50 bg-warn/10 px-2.5 text-[12px] font-medium text-warn hover:bg-warn/20">
              сектор {s.n}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="луна" value={pct(f.moon_illumination)} />
        <Stat label="вода" value={`${f.water_temp > 0 ? '+' : ''}${Math.round(f.water_temp)}°`} />
        <Stat label="ветер" value={`${f.wind_ms} м/с`} />      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted">{f.moon_phase}, {f.weekday}. Чем темнее ночь и теплее вода, тем выше риск.</p>
    </section>
  );
}

const KIND_DOT = { motor: 'bg-alert', shot: 'bg-alert', silence: 'bg-warn', offline: 'bg-grey' } as const;
const STATUS = { new: 'ждёт решения', intercept: 'перехват', resolved: 'закрыт' } as const;

function EventFeed({ state, handle }: { state: State; handle: Handle }) {
  if (!state.alerts.length) return <p className="px-5 py-4 text-[13px] text-muted">Событий пока не было.</p>;
  return (
    <ul className="px-5">
      {state.alerts.map((a) => (
        <li key={a.id}>
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
const ORDER = { alert: 0, warn: 1, offline: 2, ok: 3 } as const;

function BuoyList({ buoys, handle }: { buoys: Buoy[]; handle: Handle }) {
  const sorted = [...buoys].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.sector - b.sector);
  return (
    <ul className="px-5">
      {sorted.map((b) => (
        <li key={b.id}>
          <button type="button" onClick={() => handle.current?.flyTo(b.lat, b.lon)}
            className="grid w-full grid-cols-[18px_1fr_auto] items-center gap-2.5 border-b border-line py-2.5 text-left text-[13px] leading-[18px] hover:bg-white/[.03]">
            <span className={`h-3.5 w-3.5 rounded-full border-[2.5px] ${RING[b.status]}`} />
            <span>
              <span className="font-medium">{b.name}</span>
              <span className="block text-[12px] text-muted">сектор {b.sector} · {BUOY_STATUS[b.status]}</span>
            </span>
            <span className={`font-mono text-[11px] ${b.battery < 30 ? 'text-warn' : 'text-muted'}`} title="Заряд батареи">{`${b.battery}\u00a0%`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function SidePanel({ state, handle }: { state: State; handle: Handle }) {
  const [tab, setTab] = useState<'events' | 'buoys'>('events');
  const active = state.alerts.find((a) => a.status === 'intercept') ?? state.alerts.find((a) => a.status === 'new');
  const online = state.buoys.filter((b) => b.status !== 'offline').length;
  const health = state.buoys.reduce((s, b) => s + b.health, 0) / (state.buoys.length || 1);
  const tabCls = (on: boolean) =>
    `-mb-px h-11 border-b-2 text-[13px] font-medium ${on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-primary'}`;
  return (
    <aside className="flex min-h-0 flex-1 flex-col border-line bg-surface md:w-[380px] md:flex-none md:shrink-0 md:border-l">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active ? <AlertCard a={active} handle={handle} /> : <ForecastCard f={state.forecast} state={state} handle={handle} />}
        <div className="sticky top-0 z-10 flex gap-5 border-b border-line bg-surface px-5">
          <button type="button" className={tabCls(tab === 'events')} onClick={() => setTab('events')}>
            Журнал событий
          </button>
          <button type="button" className={tabCls(tab === 'buoys')} onClick={() => setTab('buoys')}>
            Буи <span className="font-mono text-[11px] text-muted">{online}/{state.buoys.length}</span>
          </button>
        </div>
        {tab === 'events' ? <EventFeed state={state} handle={handle} /> : (
          <>
            <p className="px-5 pt-3 text-[12px] leading-[17px] text-muted">
              На связи {plural(online, ['буй', 'буя', 'буёв'])} из {state.buoys.length} · здоровье сети {pct(health)}. Нажмите на буй — карта покажет его.
            </p>
            <BuoyList buoys={state.buoys} handle={handle} />
          </>
        )}
      </div>
    </aside>
  );
}
