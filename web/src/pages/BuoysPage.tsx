import { useEffect, useState } from 'react';
import type { Alert, State } from '../types';
import { BUOY_STATUS } from '../geo';
import { pct } from '../format';
import { api } from '../live';
import { Kpi, Page } from './common';

const RING = { ok: 'border-accent', warn: 'border-warn', alert: 'border-alert', offline: 'border-grey' } as const;
const DOT = { ok: 'bg-accent', warn: 'bg-warn', alert: 'bg-alert', offline: 'bg-grey' } as const;
const TONE = { ok: 'text-accent', warn: 'text-warn', alert: 'text-alert', offline: 'text-grey' } as const;

/** Сеть буёв: связь, заряд, «слух» и сколько каждый услышал. */
export default function BuoysPage({ state, toBuoy }: { state: State; toBuoy: (id: string) => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => { api.alerts(300).then(setAlerts).catch(() => setAlerts([])); }, [state.alerts.length]);
  const since = new Date(state.now).getTime() - 30 * 86400e3;
  const heard = (id: string) => alerts.filter((a) => a.buoy_id === id && new Date(a.ts).getTime() >= since).length;
  const online = state.buoys.filter((b) => b.status !== 'offline').length;
  const health = state.buoys.reduce((s, b) => s + b.health, 0) / (state.buoys.length || 1);
  const low = state.buoys.filter((b) => b.battery < 30).length;
  const order = { alert: 0, warn: 1, offline: 2, ok: 3 } as const;

  return (
    <Page cap="Сеть" title="Буи" lead="Каждый буй слушает воду круглые сутки: мотор, выстрел, необычную тишину. Здоровье — насколько чисто он слышит звуки природы вокруг себя.">
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="На связи" value={online} suffix={`из ${state.buoys.length}`} tone={online === state.buoys.length ? 'text-accent' : 'text-warn'} />
        <Kpi label="Здоровье сети" value={Math.round(health * 100)} suffix="%" delay={60} />
        <Kpi label="Нужна замена батареи" value={low} delay={120} tone={low ? 'text-warn' : ''} hint="заряд ниже 30 %" />
        <Kpi label="Услышали за 30 ночей" value={alerts.filter((a) => new Date(a.ts).getTime() >= since).length} delay={180} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...state.buoys].sort((a, b) => order[a.status] - order[b.status] || a.sector - b.sector).map((b, i) => (
          <button key={b.id} type="button" onClick={() => toBuoy(b.id)}
            className="card enter group !p-4 text-left transition-[transform,border-color] hover:-translate-y-0.5 hover:border-white/25"
            style={{ animationDelay: `${100 + i * 40}ms` }}>
            <div className="flex items-start gap-3">
              <span className={`relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] ${RING[b.status]}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${DOT[b.status]} ${b.status === 'alert' ? 'live-dot' : ''}`} />
                {b.status !== 'offline' && <span className="buoy-ring" style={{ animationDelay: `${(i * 0.7) % 3}s` }} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-[15px] font-semibold">{b.name}</h3>
                  <span className="font-mono text-[11px] text-muted">сектор {b.sector}</span>
                </div>
                <div className={`text-[12px] font-medium ${TONE[b.status]}`}>{BUOY_STATUS[b.status]}</div>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
              {[
                ['батарея', `${b.battery} %`, b.battery / 100, b.battery < 30 ? 'bg-warn' : 'bg-[#8E9C80]'],
                ['здоровье', pct(b.health), b.health, 'bg-[#8E9C80]'],
                ['услышал', String(heard(b.id)), Math.min(1, heard(b.id) / 10), 'bg-primary/70'],
              ].map(([k, v, f, c]) => (
                <div key={k as string}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="mt-0.5 font-mono text-[13px]">{v}</dd>
                  <div className="mt-1.5 h-1 rounded-full bg-white/[.07]"><div className={`bar-grow-x h-full rounded-full ${c}`} style={{ width: `${(f as number) * 100}%` }} /></div>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
              <span className="font-mono">{b.lat.toFixed(3)}° N {b.lon.toFixed(3)}° E</span>
              <span className="transition-transform group-hover:translate-x-0.5">на карте →</span>
            </div>
          </button>
        ))}
      </div>
    </Page>
  );
}
