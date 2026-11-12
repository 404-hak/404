import { useEffect, useState } from 'react';
import type { NightForecast } from '../types';
import { pct } from '../format';
import { api } from '../live';
import { AreaLine } from '../components/charts';
import Moon from '../components/Moon';
import { Card, Loading, Page, day } from './common';

const LEVEL = {
  low: { word: 'низкий', text: 'text-accent', ring: 'border-line' },
  elevated: { word: 'повышенный', text: 'text-warn', ring: 'border-warn/30' },
  high: { word: 'высокий', text: 'text-warn', ring: 'border-warn/70' },
} as const;

/** Из чего складывается риск — те же веса, что в формуле API (api/app/forecast.py). */
const FACTORS = [
  { title: 'Темнота', max: 35, text: 'Чем меньше луны, тем легче выйти незамеченным. Безлунная ночь даёт весь вклад.' },
  { title: 'Нерестовое окно', max: 20, text: 'Вода +8…+14° — осетровые идут на нерест. +5…+18° — частично.' },
  { title: 'Выходные', max: 18, text: 'Пятница и суббота — пик выходов, воскресенье — меньше.' },
  { title: 'Штиль', max: 7, text: 'Ветер слабее 5 м/с — удобно идти на лодке.' },
  { title: 'Фон', max: 12, text: 'Базовый риск любой ночи.' },
];

/** Прогноз на две недели: какие ночи опаснее и почему — для планирования патрулей. */
export default function ForecastPage() {
  const [nights, setNights] = useState<NightForecast[] | null>(null);
  useEffect(() => { api.nights(14).then(setNights).catch(() => setNights([])); }, []);
  const top = nights ? [...nights].sort((a, b) => b.risk - a.risk).slice(0, 3).map((n) => n.date) : [];
  const worst = nights?.find((n) => n.date === top[0]);

  return (
    <Page cap="Аналитика" title="Прогноз ночей"
      lead="Риск выхода браконьеров на 14 ночей вперёд: настоящий лунный календарь, сезонная температура воды и день недели. Ветер пока средний сезонный — до подключения погодных данных.">
      {!nights ? <Loading /> : !nights.length ? <p className="text-muted">Прогноз недоступен.</p> : (
        <>
          {worst && (
            <section className="card enter mb-4 flex flex-wrap items-center gap-5 !border-warn/40" style={{ background: 'linear-gradient(120deg, rgb(var(--rgb-warn) / .12), transparent 60%), var(--c-card)' }}>
              <Moon illumination={worst.moon_illumination} phase={worst.moon_phase} size={56} />
              <div className="min-w-0 flex-1">
                <div className="cap !text-warn">Самая опасная ночь</div>
                <div className="mt-1 text-[22px] font-semibold leading-7">{worst.weekday}, {day(worst.date).d} {day(worst.date).m}</div>
                <div className="mt-1 text-[13px] text-muted">{worst.moon_phase}, вода {worst.water_temp > 0 ? '+' : ''}{Math.round(worst.water_temp)}°. Усилить патрули в горячих секторах.</div>
              </div>
              <div className="text-right">
                <div className="font-light tabular-nums text-[48px] leading-[52px] text-warn">{Math.round(worst.risk * 100)}<span className="text-[22px]"> %</span></div>
                <div className="text-[12px] text-muted">риск</div>
              </div>
            </section>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
            {nights.map((n, i) => {
              const d = day(n.date), lv = LEVEL[n.level], isTop = top.includes(n.date);
              return (
                <article key={n.date} className={`card enter relative !p-3.5 transition-transform hover:-translate-y-0.5 ${lv.ring} ${i === 0 ? 'ring-1 ring-primary/40' : ''}`}
                  style={{ animationDelay: `${80 + i * 35}ms` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-muted">{i === 0 ? 'сегодня' : d.wd}</span>
                    <Moon illumination={n.moon_illumination} phase={n.moon_phase} size={18} />
                  </div>
                  <div className="mt-0.5 text-[13px]">{d.d} {d.m.slice(0, 3)}</div>
                  <div className={`mt-2 font-light tabular-nums text-[28px] leading-8 ${lv.text}`}>{Math.round(n.risk * 100)}<span className="text-[14px]"> %</span></div>
                  <div className="mt-1 h-1 rounded-full bg-white/10"><div className={`h-full rounded-full ${n.level === 'low' ? 'bg-accent' : 'bg-warn'}`} style={{ width: `${n.risk * 100}%` }} /></div>
                  <div className="mt-2 text-[11px] text-muted">луна {pct(n.moon_illumination)} · {n.water_temp > 0 ? '+' : ''}{Math.round(n.water_temp)}°</div>
                  {isTop && <span className="absolute -top-2 right-2 rounded-full bg-warn px-1.5 py-px text-[9px] font-bold uppercase tracking-[.06em] text-bg">патруль</span>}
                </article>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Риск по ночам" note="наведите на график" delay={200}>
              <div className="pl-6">
                <AreaLine label="Риск на 14 ночей" height={150} every={2} refLines={[{ at: 0.7, text: 'высокий' }]}
                  data={nights.map((n) => ({ key: n.date, label: day(n.date).short, value: n.risk,
                    tip: <><b>{n.weekday}, {day(n.date).d} {day(n.date).m}</b><br />риск {pct(n.risk)} · {n.moon_phase}</> }))} />
              </div>
            </Card>
            <Card title="Из чего складывается риск" note="до 92 % в сумме" delay={260}>
              <ul className="space-y-3">
                {FACTORS.map((f) => (
                  <li key={f.title}>
                    <div className="flex items-baseline justify-between text-[13px]"><span className="font-medium">{f.title}</span><span className="font-mono text-[12px] text-muted">до +{f.max}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/[.06]"><div className="bar-grow-x h-full rounded-full bg-[var(--c-bar)]" style={{ width: `${(f.max / 35) * 100}%` }} /></div>
                    <p className="mt-1 text-[12px] leading-4 text-muted">{f.text}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12px] leading-4 text-muted">Сейчас это прозрачная эвристика. Её заменит обученная модель на истории событий — сам расчёт и этот экран останутся.</p>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
