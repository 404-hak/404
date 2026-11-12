import { Fragment } from 'react';
import type { ModelMeta } from '../../lab';
import { num, pct0 } from '../../lab';

/** Карточка модели: на чём училась сеть, как её проверяли и где она ошибается. */

const Big = ({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: string }) => (
  <div className="rounded-[12px] border border-line bg-bg/40 p-3">
    <div className="text-[11px] text-muted">{label}</div>
    <div className={`mt-0.5 font-light tabular-nums text-[26px] leading-8 tracking-[-.02em] ${tone}`}>{value}</div>
    <div className="text-[11px] leading-[14px] text-muted">{note}</div>
  </div>
);
const RU = ['фон', 'мотор', 'выстрел'];

export default function ModelCard({ meta }: { meta: ModelMeta }) {
  const e = meta.metrics.events, v = meta.metrics.vessels_held_out, c = meta.metrics.calibration, t = meta.trained_on;
  const cm = e.confusion, max = Math.max(...cm.flat());
  const snr = c?.motor_recall_by_snr ?? e.motor_recall_by_snr;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Big label="верных ответов" value={pct0(e.accuracy)} note={`фон / мотор / выстрел, ${Math.round(t.synthetic_event_clips / 4)} новых клипов`} />
        <Big label="мотор: ложных тревог" value={c ? `${num(c.false_motor_two_in_row * 100, 3)} %` : '—'}
          note={c ? `${num(c.false_motor_per_clip * 100, 1)} % на клип, но нужно два подряд` : ''} tone="text-warn" />
        <Big label="выстрел: ловим" value={c ? pct0(c.shot_recall) : pct0(e.recall_shot)} note={c ? `при ${num(c.false_shot_per_clip * 100, 2)} % ложных на клип фона` : ''} tone="text-alert" />
        <Big label="узнаём катер" value={pct0(v.identification_rank1)} note={`среди ${v.vessels} новых катеров по 3 проходам; AUC ${num(v.auc, 3)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr]">
        <div>
          <div className="mb-2 text-[12px] text-muted">Матрица ошибок: строки — что было, столбцы — что ответила сеть</div>
          <div className="grid grid-cols-[64px_repeat(3,1fr)] gap-[3px] text-center text-[11px]">
            <span />
            {RU.map((x) => <span key={x} className="text-muted">{x}</span>)}
            {cm.map((row, i) => (
              <Fragment key={i}>
                <span className="self-center text-left text-muted">{RU[i]}</span>
                {row.map((n, j) => (
                  <span key={`${i}${j}`} className={`rounded-[6px] py-2 font-mono ${i === j ? 'font-semibold' : ''} ${n / max > 0.55 ? 'text-bg' : 'text-primary'}`}
                    style={{ background: i === j ? `rgb(var(--rgb-accent) / ${(0.15 + 0.85 * n / max).toFixed(2)})` : `rgb(var(--rgb-alert) / ${(Math.min(0.6, n / max * 6) + (n ? 0.08 : 0.03)).toFixed(2)})` }}>
                    {n}
                  </span>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] text-muted">Мотор на клип по громкости над фоном</div>
          <ul className="space-y-2.5">
            {Object.entries(snr).map(([k, val]) => (
              <li key={k}>
                <div className="flex justify-between text-[12px]"><span>{k}</span><span className="font-mono">{pct0(val)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-white/[.06]"><div className="bar-grow-x h-full rounded-full bg-warn" style={{ width: `${val * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-[12px] text-muted">Живость природы: ошибка ±{num(meta.metrics.bio.mae, 2)}, R² {num(meta.metrics.bio.r2, 2)}</div>
        </div>
        <div className="text-[12px] leading-[18px] text-muted">
          <div className="mb-1 font-medium text-primary">На чём училась</div>
          {t.synthetic_event_clips.toLocaleString('ru-RU')} клипов событий и {t.synthetic_vessel_clips.toLocaleString('ru-RU')} проходов {t.train_vessels} катеров,
          синтезированных по физике источников: моторы со своей «подписью» (цилиндры, винт, резонансы корпуса), выстрелы с эхом,
          лягушки, птицы, сверчки, ветер, дождь и помехи — самолёт, всплеск рыбы, удар весла, гром.
          {t.real_event_clips + t.real_vessel_clips > 0 ? ` Плюс ${t.real_event_clips + t.real_vessel_clips} настоящих записей.` : ' Настоящих записей заповедника пока нет.'}
          <div className="mt-2">Проверка — на том, чего сеть не видела: новые клипы, {v.vessels} новых катеров, отдельные {c ? c.background_clips.toLocaleString('ru-RU') : '—'} клипов фона для порогов.
            На настоящей воде цифры будут другими — сеть дообучается на записях: <span className="font-mono text-primary">tools/ml/train.py --data</span>.</div>
          <div className="mt-2 font-mono text-[11px]">версия {meta.version} · отпечаток {meta.embedding_dim} чисел</div>
        </div>
      </div>
    </div>
  );
}
