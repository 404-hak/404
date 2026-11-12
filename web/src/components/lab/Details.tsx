import type { LabFeature, LabResult } from '../../lab';
import { num, pct0 } from '../../lab';

/** Карточки разбора: мотор (гармоники, отпечаток, архив), удар, природа, все признаки клипа. */

const Metric = ({ label, value, note, tone = '' }: { label: string; value: string; note?: string; tone?: string }) => (
  <div className="rounded-[10px] border border-line bg-bg/40 px-3 py-2">
    <div className="text-[11px] text-muted">{label}</div>
    <div className={`font-mono text-[18px] leading-6 ${tone}`}>{value}</div>
    {note && <div className="text-[11px] leading-[14px] text-muted">{note}</div>}
  </div>
);

// ---------- мотор ----------
export function MotorDetail({ r }: { r: LabResult }) {
  const m = r.motor;
  if (!m) {
    const best = Math.max(...r.timeline.map((p) => p.motor));
    return (
      <div className="grid h-full place-items-center py-8 text-center text-[13px] text-muted">
        <div>Мотора не слышно.<br />Самая высокая вероятность мотора за запись — {pct0(best)}.<br />
          Отпечаток снимается, когда сеть слышит мотор хотя бы на 25 %.</div>
      </div>
    );
  }
  const W = 1000, H = 150;
  const db = m.psd.db, lo = Math.min(...db), hi = Math.max(...db);
  const fx = (hz: number) => (hz / (db.length * m.psd.hz_step)) * W;
  const fy = (v: number) => H - 4 - ((v - lo) / (hi - lo + 1e-9)) * (H - 14);
  const line = db.map((v, i) => `${i ? 'L' : 'M'}${fx(i * m.psd.hz_step).toFixed(1)} ${fy(v).toFixed(1)}`).join(' ');
  const fpMax = Math.max(...m.fingerprint, 1e-6);
  const known = m.matches[0] && m.matches[0].similarity >= m.match_threshold;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="основная частота" value={`${num(m.f0_hz, 1)} Гц`} note={`если это вал — ≈ ${m.rpm_if_crank.toLocaleString('ru-RU')} об/мин`} />
        <Metric label="гармоничность" value={num(m.harmonicity, 1)} note="сила гармонического ряда" />
        <Metric label="мотор в окне" value={pct0(m.probability)} note={`окно с ${num(m.window_start, 1)} с`} tone="text-warn" />
      </div>

      <div className="mt-4 text-[12px] text-muted">Спектр 0–1,6 кГц: гармоники мотора — кратные основной частоте (отмечены)</div>
      <div className="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[150px] w-full overflow-visible" role="img" aria-label="Спектр мотора с отмеченными гармониками">
          {m.harmonics.map((h) => (
            <g key={h.k}>
              <line x1={fx(h.hz)} x2={fx(h.hz)} y1={fy(h.db)} y2={H} strokeDasharray="2 3" style={{ stroke: 'rgb(var(--rgb-warn) / .45)' }} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          <path d={line} fill="none" style={{ stroke: 'var(--c-primary)' }} strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
          {m.harmonics.map((h) => <circle key={h.k} cx={fx(h.hz)} cy={fy(h.db)} r={3} style={{ fill: 'var(--c-warn)' }} />)}
        </svg>
        {m.harmonics.filter((h) => h.k <= 8 || h.k % 4 === 0).map((h) => (
          <span key={h.k} className="pointer-events-none absolute -translate-x-1/2 font-mono text-[9px] text-warn" style={{ left: `${(fx(h.hz) / W) * 100}%`, top: `${(fy(h.db) / H) * 100 - 14}%` }}>{h.k}</span>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>0</span><span>400 Гц</span><span>800 Гц</span><span>1,2 кГц</span><span>1,6 кГц</span></div>

      <div className="mt-4 text-[12px] text-muted">Отпечаток катера — {m.fingerprint.length} чисел последнего скрытого слоя сети</div>
      <div className="mt-1 flex h-7 overflow-hidden rounded-[6px] border border-line" role="img" aria-label="Отпечаток катера">
        {m.fingerprint.map((v, i) => (
          <span key={i} className="flex-1" title={`${i + 1}: ${num(v, 3)}`} style={{ background: `rgb(var(--rgb-warn) / ${(0.06 + 0.94 * (v / fpMax)).toFixed(3)})` }} />
        ))}
      </div>

      <div className="mt-4 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">Сверка с архивом катеров (косинусное сходство)</span>
        <span className={`font-medium ${known ? 'text-warn' : 'text-primary'}`}>{m.verdict}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {m.matches.map((x) => {
          const pass = x.similarity >= m.match_threshold;
          const w = Math.max(0, (x.similarity - 0.5) / 0.5);
          return (
            <li key={x.vessel_id} className="grid grid-cols-[72px_1fr_56px] items-center gap-2 text-[12px]">
              <span className={`font-mono ${pass ? 'text-warn' : 'text-muted'}`}>{x.vessel_id}</span>
              <span className="relative h-2 rounded-full bg-white/[.06]">
                <span className={`bar-grow-x absolute inset-y-0 left-0 rounded-full ${pass ? 'bg-warn' : 'bg-[var(--c-bar)]'}`} style={{ width: `${w * 100}%` }} />
                <span className="absolute -inset-y-1 w-px bg-primary/70" style={{ left: `${((m.match_threshold - 0.5) / 0.5) * 100}%` }} title="порог «тот же катер»" />
              </span>
              <span className="text-right font-mono">{num(x.similarity * 100, 1)} %</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-[15px] text-muted">Шкала от 50 %; черта — порог «тот же катер» ({num(m.match_threshold * 100, 1)} %): ниже него не больше 1 % чужих катеров. Здесь архив не меняется — в работе узнанный катер уточняет свой образ.</p>
    </div>
  );
}

// ---------- удар ----------
export function ImpulseDetail({ r }: { r: LabResult }) {
  const im = r.impulse;
  const W = 1000, H = 130, y = im.zoom.y, n = y.length;
  const path = y.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * W).toFixed(1)} ${(H / 2 - v * (H / 2 - 4)).toFixed(1)}`).join(' ');
  const peakX = ((im.t - im.zoom.t0) / (im.zoom.t1 - im.zoom.t0)) * W;
  const shotLike = im.rise_ms < 2 && im.crest_db > 28;
  return (
    <div>
      <div className="text-[12px] text-muted">Самый резкий звук записи — на {num(im.t, 2)} с; 100 мс вокруг него</div>
      <div className="relative mt-1 rounded-[10px] border border-line bg-bg/40">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[130px] w-full" role="img" aria-label="Волна вокруг самого резкого звука">
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} style={{ stroke: 'rgb(var(--rgb-primary) / .1)' }} vectorEffect="non-scaling-stroke" />
          <line x1={peakX} x2={peakX} y1={0} y2={H} style={{ stroke: 'rgb(var(--rgb-alert) / .6)' }} vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" style={{ stroke: 'var(--c-primary)' }} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute bottom-1 left-2 font-mono text-[10px] text-muted">−40 мс</span>
        <span className="absolute bottom-1 right-2 font-mono text-[10px] text-muted">+60 мс</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="пик к среднему" value={`${num(im.crest_db, 1)} дБ`} note="выстрел — обычно 30+" tone={im.crest_db > 28 ? 'text-alert' : ''} />
        <Metric label="фронт удара" value={`${num(im.rise_ms, im.rise_ms < 10 ? 2 : 0)} мс`} note="выстрел — около 1 мс" tone={im.rise_ms < 2 ? 'text-alert' : ''} />
        <Metric label="центр спектра" value={`${num(im.centroid_khz, 2)} кГц`} note="весло — низкий, выстрел — шире" />
      </div>
      <p className="mt-3 text-[12px] leading-[17px] text-muted">
        Выстрел сеть узнаёт по сочетанию: резкий фронт за доли миллисекунды, высокий пик над фоном, быстрый спад и эхо.
        Удар весла и всплеск рыбы нарастают медленнее и звучат ниже. Здесь вероятность выстрела в лучшем окне —{' '}
        <b className={im.shot_probability >= r.thresholds.shot ? 'text-alert' : 'text-primary'}>{pct0(im.shot_probability)}</b>
        {' '}(порог {num(r.thresholds.shot * 100, 1)} %){shotLike ? '; по фронту и пику удар похож на выстрел' : ''}.
      </p>
    </div>
  );
}

// ---------- природа ----------
export function NatureDetail({ r }: { r: LabResult }) {
  const c = r.nature.bio_curve, n = c.length;
  const W = 1000, H = 110, mx = Math.max(6, ...c);
  const line = c.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, n - 1)) * W).toFixed(1)} ${(H - 4 - (v / mx) * (H - 10)).toFixed(1)}`).join(' ');
  const silence = r.clips.find((x) => x.alert === 'silence');
  const lastBase = [...r.clips].reverse().find((x) => x.baseline != null)?.baseline ?? null;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="живость природы" value={num(r.nature.activity, 2)} note="0 — тишина, 1 — хор" tone="text-accent" />
        <Metric label="обычная у буя" value={lastBase != null ? num(lastBase, 2) : '—'} note="копится по спокойным клипам" />
        <Metric label="тишина как улика" value={silence ? `клип ${silence.i}` : 'нет'} note="ниже 40 % обычной 3 клипа" tone={silence ? 'text-alert' : ''} />
      </div>
      <div className="mt-4 text-[12px] text-muted">Голоса в полосе 1,2–7,6 кГц над шумовым полом, дБ</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1 h-[110px] w-full" role="img" aria-label="Энергия голосов природы по времени">
        <path d={`${line} L${W} ${H} L0 ${H} Z`} style={{ fill: 'rgb(var(--rgb-accent) / .18)' }} />
        <path d={line} fill="none" style={{ stroke: 'var(--c-accent)' }} strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-2 text-[12px] leading-[17px] text-muted">
        Лягушки, птицы и сверчки звучат в полосе 1,2–7,6 кГц — вторая сеть оценивает по ней живость 0–1. Ухо буя помнит
        обычную живость своего места; если природа стихла ниже 40 % обычной три клипа подряд, рядом, скорее всего, человек —
        тревога «тишина», даже без мотора.
      </p>
    </div>
  );
}

// ---------- признаки ----------
const RANGE: Record<string, [number, number, boolean?]> = {
  onset: [0, 40], crest: [0, 40], decay: [0, 40], harm: [0, 12], log_f0: [15, 420, true], low: [-3, 0], flat: [0, 1],
  aci: [0, 1.2], bio_act: [0, 14], mod: [0, 3], imp_crest: [0, 45], imp_rise: [0.1, 100, true], imp_centroid: [0, 4],
};
const fmtVal = (f: LabFeature) => (Math.abs(f.value) >= 100 ? Math.round(f.value).toString() : num(f.value, Math.abs(f.value) < 1 ? 3 : 1));

export function FeaturesDetail({ r }: { r: LabResult }) {
  const clip = r.clips.find((c) => c.i === r.main_clip)!;
  return (
    <div>
      <p className="mb-3 text-[12px] leading-[17px] text-muted">
        Клип {clip.i} ({num(clip.start, 0)}–{num(clip.end, 0)} с) — {clip.alert ? 'на нём ухо буя подняло тревогу' : 'самый «подозрительный» в записи'}.
        Кроме этих 13 чисел сеть смотрит на спектр по 64 полосам: среднее, разброс, пики над шумовым полом и форму — всего 269 признаков.
      </p>
      <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {r.features.map((f) => {
          const [a, b, log] = RANGE[f.key] ?? [0, 1];
          const k = log ? (Math.log(Math.max(a, f.value)) - Math.log(a)) / (Math.log(b) - Math.log(a)) : (f.value - a) / (b - a);
          return (
            <li key={f.key} title={f.hint}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-medium">{f.label}</span>
                <span className="font-mono">{fmtVal(f)}{f.unit ? ` ${f.unit}` : ''}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/[.06]">
                <div className="bar-grow-x h-full rounded-full bg-[var(--c-bar)]" style={{ width: `${Math.max(2, Math.min(100, k * 100))}%` }} />
              </div>
              <div className="mt-0.5 text-[11px] leading-[14px] text-muted">{f.hint}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
