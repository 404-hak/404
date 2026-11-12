import type { Alert, Forecast, State } from '../types';
import { KIND_TITLE, coord, fmtDM, fmtHM, fmtTime, isToday, km, pct, shortHash } from '../format';
import { api } from '../live';

const LEVEL_COLOR = { low: 'text-accent', elevated: 'text-warn', high: 'text-warn' } as const;

function AlertCard({ a }: { a: Alert }) {
  const intercept = a.status === 'intercept';
  return (
    <section className="border-b border-line p-5">
      <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.08em] text-alert">
        <span className="h-[7px] w-[7px] rounded-full bg-alert" />{intercept ? 'Перехват' : 'Тревога'} · {fmtTime(a.ts)}
      </div>
      <h2 className="mt-3 text-[17px] font-semibold leading-[22px]">{KIND_TITLE[a.kind]} · {a.buoy_name}</h2>
      <p className="mt-2 text-[14px] leading-[21px]">{a.message}</p>
      {a.match && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-chip border border-line px-2 py-1 font-mono text-[11px] text-muted">
          отпечаток {a.match.vessel_id} · {pct(a.match.similarity)}
        </div>
      )}
      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-y-1.5 font-mono text-[11px] leading-4">
        <dt className="text-muted">уверенность</dt><dd>{pct(a.confidence)}</dd>
        <dt className="text-muted">сектор</dt><dd>{a.sector}</dd>
        <dt className="text-muted">до цели</dt><dd>{a.distance_km != null ? km(a.distance_km) : '—'}</dd>
        <dt className="text-muted">координаты</dt><dd>{coord(a.lat, a.lon)}</dd>
        <dt className="text-muted">SHA-256</dt><dd title={a.hash}>{shortHash(a.hash)}</dd>
      </dl>
      <div className="mt-5 flex gap-2">
        {!intercept && (
          <button className="h-9 flex-1 rounded-[9px] bg-alert text-[13px] font-semibold text-bg" onClick={() => api.setAlertStatus(a.id, 'intercept')}>
            Перехват
          </button>
        )}
        <button className="h-9 flex-1 rounded-[9px] border border-line text-[13px] font-semibold hover:border-grey"
          onClick={() => api.setAlertStatus(a.id, 'resolved')}>
          {intercept ? 'Задержан — закрыть' : 'Ложная тревога'}
        </button>
      </div>
    </section>
  );
}

function ForecastCard({ f }: { f: Forecast }) {
  return (
    <section className="border-b border-line p-5">
      <div className="cap">Прогноз на ночь{f.demo ? ' · демо-условия' : ''}</div>
      <div className={`mt-2 text-[56px] font-light leading-[60px] tracking-[-.02em] ${LEVEL_COLOR[f.level]}`}>{pct(f.risk)}</div>
      <p className="mt-2 text-[14px] leading-[21px]">«{f.message}»</p>
      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-y-1.5 font-mono text-[11px] leading-4">
        <dt className="text-muted">луна</dt><dd>{f.moon_phase} · {pct(f.moon_illumination)}</dd>
        <dt className="text-muted">день</dt><dd>{f.weekday}</dd>
        <dt className="text-muted">вода</dt><dd>{f.water_temp > 0 ? '+' : ''}{f.water_temp}°</dd>
        <dt className="text-muted">ветер</dt><dd>{f.wind_ms} м/с</dd>
        {f.hot_sectors.length > 0 && (<><dt className="text-muted">горячие</dt><dd className="text-warn">сектор {f.hot_sectors.join(', ')}</dd></>)}
      </dl>
    </section>
  );
}

const DOT = { motor: 'bg-alert', shot: 'bg-alert', silence: 'bg-warn', offline: 'bg-grey' } as const;
const STATUS = { new: 'новый', intercept: 'перехват', resolved: 'закрыт' } as const;

function EventFeed({ state }: { state: State }) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="cap">Журнал событий</div>
      <ul className="mt-3">
        {state.alerts.map((a) => (
          <li key={a.id} className="grid grid-cols-[58px_1fr] gap-2 border-b border-line py-2.5 text-[12px] leading-[17px]">
            <span className="font-mono text-[11px] text-muted">{isToday(a.ts, state.now) ? fmtHM(a.ts) : fmtDM(a.ts)}</span>
            <span>
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle ${DOT[a.kind]}`} />
              <span className="font-medium">{KIND_TITLE[a.kind]}</span>
              <span className="text-muted"> · {a.buoy_name} · {STATUS[a.status]}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SidePanel({ state }: { state: State }) {
  const active = state.alerts.find((a) => a.status === 'intercept') ?? state.alerts.find((a) => a.status === 'new');
  return (
    <aside className="flex min-h-0 flex-col border-line bg-surface md:w-[360px] md:shrink-0 md:border-l">
      {active ? <AlertCard a={active} /> : <ForecastCard f={state.forecast} />}
      <EventFeed state={state} />
    </aside>
  );
}
