import { useEffect, useState } from 'react';
import type { State, Stats } from '../types';
import { KIND_TITLE, pct } from '../format';
import { api } from '../live';
import { AreaLine, Bars, HBars, HeatGrid } from '../components/charts';
import { Card, Kpi, Loading, Page, day } from './common';

const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const KIND_ORDER = ['motor', 'silence', 'offline', 'shot'];

/** Аналитика: как риск по ночам связан с тем, что на самом деле слышат буи. */
export default function StatsPage({ state }: { state: State }) {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const resolved = state.alerts.filter((a) => a.status === 'resolved').length;
  useEffect(() => { api.stats(days).then(setS).catch(() => setS(null)); }, [days, resolved]);

  const hottest = s ? Object.entries(s.by_sector).sort((a, b) => b[1] - a[1])[0] : null;
  const every = days > 20 ? 5 : days > 10 ? 2 : 1;
  const nightsHigh = s?.nights.filter((n) => n.risk >= 0.7) ?? [];
  const evHigh = nightsHigh.reduce((a, n) => a + n.events, 0) / (nightsHigh.length || 1);
  const nightsLow = s?.nights.filter((n) => n.risk < 0.7) ?? [];
  const evLow = nightsLow.reduce((a, n) => a + n.events, 0) / (nightsLow.length || 1);

  return (
    <Page cap="Аналитика" title="Статистика"
      lead={<>Что услышали буи за последние ночи и совпадает ли это с прогнозом риска.{s?.synthetic && <> В демо сюда входит <b className="font-medium text-primary">сгенерированная история</b>: настоящих данных заповедника пока нет.</>}</>}
      aside={
        <div className="flex rounded-[10px] border border-line bg-bg/70 p-[3px]" role="group" aria-label="Период">
          {[7, 14, 30, 60].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={d === days}
              className={`h-8 rounded-[7px] px-3 text-[12px] font-medium ${d === days ? 'bg-primary text-bg' : 'text-muted hover:text-primary'}`}>{d} ночей</button>
          ))}
        </div>
      }>
      {!s ? <Loading /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Событий" value={s.total} hint={`за ${days} ночей`} />
            <Kpi label="Моторов" value={s.by_kind.motor ?? 0} delay={60} hint="самый частый признак браконьера" />
            <Kpi label="Медиана реакции" value={s.reaction_median_min} suffix="мин" delay={120} hint="от сигнала до выхода катера" />
            <Kpi label="Горячий сектор" value={hottest ? Number(hottest[0]) : null} delay={180} tone="text-warn" hint={hottest ? `${hottest[1]} событий` : undefined} />
          </div>

          <Card title="Прогноз и реальность" delay={120}
            note={nightsHigh.length > 0 && nightsLow.length > 0 ? <>в ночи с риском ≥ 70 % — <b className="text-primary">{evHigh.toFixed(1).replace('.', ',')}</b> событий за ночь, в остальные — <b className="text-primary">{evLow.toFixed(1).replace('.', ',')}</b></> : undefined}>
            <div className="pl-6">
              <div className="mb-1 text-[12px] text-muted">Риск ночи, %</div>
              <AreaLine label="Риск по ночам" every={every} refLines={[{ at: 0.7, text: 'высокий' }]}
                data={s.nights.map((n) => ({
                  key: n.date, label: day(n.date).short, value: n.risk,
                  tip: <><b>{day(n.date).wd}, {day(n.date).d} {day(n.date).m}</b><br />риск {pct(n.risk)} · луна {pct(n.moon_illumination)}</>,
                }))} />
              <div className="mb-1 mt-6 text-[12px] text-muted">Событий за ночь</div>
              <Bars label="События по ночам" every={every} height={110}
                data={s.nights.map((n) => ({
                  key: n.date, label: day(n.date).short, value: n.events, strong: n.risk >= 0.7,
                  tip: <><b>{day(n.date).wd}, {day(n.date).d} {day(n.date).m}</b><br />{n.events ? Object.entries(n.by_kind).map(([k, v]) => `${KIND_TITLE[k].toLowerCase()} ${v}`).join(', ') : 'тихо'}</>,
                }))} />
              <p className="mt-3 text-[12px] text-muted"><span className="mr-1.5 inline-block h-2 w-3 rounded-[2px] bg-[#C9D4BC] align-middle" />светлые столбики — ночи с высоким риском</p>
            </div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Что слышали" delay={200}>
              <HBars data={KIND_ORDER.map((k) => ({ key: k, label: KIND_TITLE[k], value: s.by_kind[k] ?? 0 }))} />
            </Card>
            <Card title="Где" note="события по секторам" delay={260}>
              <HeatGrid counts={s.by_sector} hot={state.forecast.level === 'high' ? state.forecast.hot_sectors : []} />
            </Card>
            <Card title="Когда" note="час ночи, местное время" delay={320}>
              <div className="pl-5">
                <Bars label="События по часам ночи" height={150} every={2}
                  data={NIGHT_HOURS.map((h) => ({ key: String(h), label: `${h}`, value: s.by_hour[h], tip: <><b>{h}:00–{(h + 1) % 24}:00</b><br />{s.by_hour[h]} событий</> }))} />
              </div>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
