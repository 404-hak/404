import { useEffect, useState } from 'react';
import type { Alert, AlertStatus, State, Stats } from '../types';
import { KIND_TITLE, fmtDM, fmtHM, isToday, km, pct } from '../format';
import { api, useMe } from '../live';
import { Kpi, Page } from './common';
import { scrambleRef } from '../upkMotion';
import SatSnap from '../components/SatSnap';

const COLS: { id: AlertStatus; title: string; hint: string; dot: string }[] = [
  { id: 'new', title: 'Ждут решения', hint: 'Начните перехват или отметьте ложную тревогу', dot: 'bg-alert' },
  { id: 'intercept', title: 'Перехват', hint: 'Катер в пути', dot: 'bg-warn' },
  { id: 'resolved', title: 'Закрыты', hint: 'Последние события', dot: 'bg-accent' },
];
const KIND_DOT = { motor: 'bg-alert', shot: 'bg-alert', silence: 'bg-warn', offline: 'bg-grey' } as const;

function AlertTile({ a, now, onMap, i }: { a: Alert; now: string; onMap: () => void; i: number }) {
  const canAct = useMe().role !== 'observer';
  const minutes = a.intercept_at ? Math.round((new Date(a.intercept_at).getTime() - new Date(a.ts).getTime()) / 60000) : null;
  return (
    <article data-alert-id={a.id} className={`ui-tile enter group rounded-[14px] border bg-bg/60 p-4 transition-[border-color,transform] duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-0.5 ${a.status === 'new' ? 'border-alert/60' : 'border-line hover:border-white/25'}`}
      style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
      <div className="ui-meta flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
        <span ref={scrambleRef}>{a.id.replace(/^A-\d+-/, '№ ')}</span>
        <span>{isToday(a.ts, now) ? fmtHM(a.ts) : `${fmtDM(a.ts)} · ${fmtHM(a.ts)}`}</span>
      </div>
      <h3 className="mt-2 flex items-center gap-2 text-[15px] font-semibold leading-5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[a.kind]} ${a.status === 'new' ? 'ping-dot' : ''}`} />{KIND_TITLE[a.kind]}
      </h3>
      <p className="mt-1 text-[13px] text-muted">у буя {a.buoy_name} · сектор {a.sector}</p>
      {a.status === 'new' && (
        <div className="mt-3"><SatSnap lat={a.lat} lon={a.lon} height={140} title={`${KIND_TITLE[a.kind]} у буя ${a.buoy_name}`} tone={a.kind === 'silence' ? 'warn' : 'alert'} /></div>
      )}
      <div className="ui-meta mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        <span>уверенность {pct(a.confidence)}</span>
        {a.distance_km != null && <span>{km(a.distance_km)} от катера</span>}
        {minutes != null && a.status === 'resolved' && <span>реакция {minutes} мин</span>}
        {a.status === 'intercept' && a.intercept_by && <span>перехват · {a.intercept_by}</span>}
        {a.status === 'resolved' && a.resolved_by && <span>закрыл · {a.resolved_by}</span>}
        {a.match && <span className="text-primary">катер {a.match.vessel_id}</span>}
        {a.estimate && <span>где катер ± {km(a.estimate.radius_km)} по {a.estimate.buoys} буям</span>}
        {a.status === 'resolved' && a.verdict && <span className={a.verdict === 'false' ? '' : 'text-primary'}>{a.verdict === 'false' ? 'ложная тревога' : 'задержан'}</span>}
      </div>
      <div className="mt-3 flex gap-2">
        {canAct && a.status === 'new' && (
          <button type="button" onClick={() => api.setAlertStatus(a.id, 'intercept')}
            className="ui-btn ui-btn-danger btn-shine ink-host h-8 flex-1 rounded-[8px] bg-alert text-[12px] font-semibold text-bg hover:bg-alert/90">Начать перехват</button>
        )}
        {canAct && a.status !== 'resolved' && (
          <button type="button" onClick={() => api.setAlertStatus(a.id, 'resolved', a.status === 'new' ? 'false' : 'confirmed')}
            className="ui-btn h-8 flex-1 rounded-[8px] border border-line text-[12px] font-semibold hover:border-grey">{a.status === 'new' ? 'Ложная' : 'Задержан'}</button>
        )}
        <button type="button" onClick={onMap} className="ui-btn ui-btn-quiet h-8 rounded-[8px] border border-line px-3 text-[12px] font-medium text-muted hover:border-grey hover:text-primary">На карте</button>
      </div>
    </article>
  );
}

/** Доска тревог: что ждёт решения, что в работе, что закрыто. */
export default function AlertsPage({ state, toBuoy }: { state: State; toBuoy: (id: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const resolvedCount = state.alerts.filter((a) => a.status === 'resolved').length;
  useEffect(() => { api.stats(30).then(setStats).catch(() => setStats(null)); }, [resolvedCount]);
  const open = state.alerts.filter((a) => a.status !== 'resolved');
  return (
    <Page cap="Дежурство" title="Тревоги" lead="Всё, что услышали буи: новое ждёт вашего решения, перехват — в пути, закрытое уходит в архив и в цепочку доказательств.">
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Открыто сейчас" value={open.length} tone={open.length ? 'text-alert' : 'text-accent'} hint={open.length ? 'ждут решения или в перехвате' : 'всё спокойно'} />
        <Kpi label="Событий за 30 ночей" value={stats?.total ?? null} delay={60} hint={stats?.synthetic ? 'с демо-историей' : undefined} />
        <Kpi label="Медиана реакции" value={stats?.reaction_median_min ?? null} suffix="мин" delay={120} digits={0} hint="от сигнала до выхода катера" />
        <Kpi label="Риск этой ночи" value={Math.round(state.forecast.risk * 100)} suffix="%" delay={180} tone={state.forecast.level === 'low' ? 'text-accent' : 'text-warn'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {COLS.map((c, ci) => {
          const items = state.alerts.filter((a) => a.status === c.id).slice(0, c.id === 'resolved' ? 8 : 20);
          return (
            <section key={c.id} className="card enter !p-3" style={{ animationDelay: `${120 + ci * 80}ms` }}>
              <header className="ui-col-head flex items-center gap-2 px-2 pb-3 pt-1">
                <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                <h2 className="card-title text-[14px] font-semibold">{c.title}</h2>
                <span className="ui-count font-mono text-[12px] text-muted">{c.id === 'resolved' ? 'последние' : state.alerts.filter((a) => a.status === c.id).length}</span>
              </header>
              <div className="space-y-2.5">
                {items.length ? items.map((a, i) => <AlertTile key={a.id} a={a} now={state.now} i={i} onMap={() => toBuoy(a.buoy_id)} />)
                  : <p className="rounded-[12px] border border-dashed border-line px-3 py-6 text-center text-[12px] text-muted">{c.hint}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
