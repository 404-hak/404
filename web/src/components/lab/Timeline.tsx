import type { LabClip, LabResult } from '../../lab';
import { memo } from 'react';
import { usePlayerSelect, type PlayerApi } from './player';
import { ALERT_RU, EVENT_RU, VOICE, fmtS, num, pct0 } from '../../lab';

/**
 * Ход по времени: вероятности мотора и выстрела (окно 4 с, шаг 0,5 с), живость природы,
 * пороги тревоги, обычная живость буя и порог тишины (40 % обычной). По графику бежит позиция
 * звука, клик — слушать с этого места. Решения уха буя по клипам — EarChips (стоят под спектрограммой).
 */

const W = 1000, H = 190;

export function earChip(c: LabClip): { text: string; short: string; cls: string } {
  if (c.alert) return { text: `Тревога: ${ALERT_RU[c.alert]}`, short: 'тревога', cls: 'border-alert bg-alert text-bg font-semibold' };
  if (c.event === 'voice') return { text: 'голоса · не тревога', short: 'голоса', cls: 'border-[#7FB2E5]/70 text-[#7FB2E5]' };
  if (c.note.includes('непривычный')) return { text: 'непривычный звук', short: 'непривычно', cls: 'border-dashed border-warn/70 text-warn' };
  if (c.note.includes('подтверждения')) return { text: 'мотор? ждём 2-й клип', short: 'ждём 2-й', cls: 'border-warn text-warn' };
  if (c.note.includes('продолжение')) return { text: `${c.event === 'shot' ? 'выстрел' : 'мотор'} · та же тревога`, short: 'та же', cls: 'border-warn/60 text-warn' };
  if (c.note.includes('ниже порога')) return { text: 'похоже, но ниже порога', short: 'ниже порога', cls: 'border-line text-muted' };
  if (c.note.includes('тишина продолжается')) return { text: 'тишина длится', short: 'тишина', cls: 'border-primary/60 text-primary' };
  if (c.note.includes('тише обычного')) return { text: `тише обычного · ${c.quiet}/3`, short: `тише ${c.quiet}/3`, cls: 'border-primary/50 text-primary' };
  return { text: 'фон', short: 'фон', cls: 'border-line text-muted' };
}

/** Решения уха буя клип за клипом — на той же оси времени, что звук; клик — слушать этот клип. */
export function EarChips({ r, player }: { r: LabResult; player: PlayerApi }) {
  const dur = r.duration_s;
  // перерисовка — только когда звук перешёл в другой клип, а не 10 раз в секунду
  const now = usePlayerSelect(player, (s) => (s.playing ? r.clips.find((c) => s.t >= c.start && s.t < c.end)?.i ?? 0 : 0));
  return (
    <div className="relative h-7">
      {r.clips.map((c) => {
        const ch = earChip(c);
        return (
          <div key={c.i} className="absolute top-0 px-0.5" style={{ left: `${(c.start / dur) * 100}%`, width: `${((c.end - c.start) / dur) * 100}%` }}>
            <button type="button" onClick={() => { player.seek(c.start); player.play(); }} title={`Клип ${c.i}, ${fmtS(c.start)}–${fmtS(c.end)}: ${c.note}. Нажмите — послушать`}
              className={`block w-full truncate rounded-[6px] border px-1.5 text-center text-[11px] leading-[24px] transition-shadow ${ch.cls} ${now === c.i ? 'shadow-[0_0_0_2px_rgb(var(--rgb-primary)/.35)]' : ''}`}>
              <span className="sm:hidden">{ch.short}</span><span className="hidden sm:inline">{ch.text}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ r, player }: { r: LabResult; player: PlayerApi }) {
  const dur = r.duration_s;
  const x = (t: number) => (t / dur) * W;
  const y = (v: number) => H - 8 - v * (H - 16);
  const pts = r.timeline;
  const path = (key: 'motor' | 'shot' | 'activity' | 'background' | 'voice') =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const area = `${path('activity')} L${x(pts[pts.length - 1].t)} ${H - 8} L${x(pts[0].t)} ${H - 8} Z`;
  // обычная живость и порог тишины — ступенькой по клипам (что знает ухо к началу клипа)
  const base = r.clips.filter((c) => c.baseline != null);
  const lines: [string, string, number][] = [['motor', 'мотор', r.thresholds.motor], ['shot', 'выстрел', r.thresholds.shot]];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-warn" />мотор</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-alert" />выстрел</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded" style={{ background: VOICE }} />голоса людей</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px] bg-accent/35" />живость природы</span>
        <span className="flex items-center gap-1.5"><i className="w-4 border-t border-dashed border-primary/70" />обычная живость и порог тишины</span>
        <span className="flex items-center gap-1.5"><i className="w-4 border-t border-dashed border-warn/70" />пороги тревоги</span>
      </div>
      <div className="relative cursor-crosshair" title="Нажмите — слушать с этого места"
        onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); player.seek(((e.clientX - b.left) / b.width) * dur); player.play(); }}>
        <div ref={player.bind} className="pointer-events-none absolute -inset-y-1 left-0 z-10 w-px bg-primary/80 will-change-transform" style={{ opacity: 0 }} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[150px] w-full overflow-visible md:h-[190px]" role="img"
          aria-label="Вероятности мотора и выстрела и живость природы по времени">
          {[0, 0.5, 1].map((v) => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: 'rgb(var(--rgb-primary) / .08)' }} vectorEffect="non-scaling-stroke" />)}
          {r.clips.slice(1).map((c) => <line key={c.i} x1={x(c.start)} x2={x(c.start)} y1={0} y2={H} strokeDasharray="3 4" style={{ stroke: 'rgb(var(--rgb-primary) / .14)' }} vectorEffect="non-scaling-stroke" />)}
          {r.marks.map((m) => <rect key={m.start} x={x(m.start)} width={x(m.end) - x(m.start)} y={0} height={H} style={{ fill: 'rgb(var(--rgb-primary) / .04)' }} />)}
          <path d={area} style={{ fill: 'rgb(var(--rgb-accent) / .22)' }} className="fade-in" />
          <path d={path('activity')} fill="none" style={{ stroke: 'rgb(var(--rgb-accent) / .9)' }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {base.map((c) => (
            <g key={c.i}>
              <line x1={x(c.start)} x2={x(c.end)} y1={y(c.baseline!)} y2={y(c.baseline!)} strokeDasharray="5 4" style={{ stroke: 'rgb(var(--rgb-primary) / .55)' }} vectorEffect="non-scaling-stroke" />
              <line x1={x(c.start)} x2={x(c.end)} y1={y(c.baseline! * 0.4)} y2={y(c.baseline! * 0.4)} strokeDasharray="2 4" style={{ stroke: 'rgb(var(--rgb-primary) / .4)' }} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {lines.map(([k, , v]) => <line key={k} x1={0} x2={W} y1={y(v)} y2={y(v)} strokeDasharray="6 5" style={{ stroke: k === 'shot' ? 'rgb(var(--rgb-alert) / .55)' : 'rgb(var(--rgb-warn) / .6)' }} vectorEffect="non-scaling-stroke" />)}
          <path d={path('motor')} fill="none" style={{ stroke: 'var(--c-warn)' }} strokeWidth={2.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1} className="line-draw" />
          <path d={path('shot')} fill="none" style={{ stroke: 'var(--c-alert)' }} strokeWidth={2.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1} className="line-draw" />
          {r.classes.includes('voice') && <path d={path('voice')} fill="none" style={{ stroke: VOICE }} strokeWidth={1.8} strokeDasharray="5 3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {pts.length === 1 && (['motor', 'shot', 'activity'] as const).map((k) => (
            <circle key={k} cx={x(pts[0].t)} cy={y(pts[0][k])} r={4} style={{ fill: k === 'motor' ? 'var(--c-warn)' : k === 'shot' ? 'var(--c-alert)' : 'var(--c-accent)' }} />
          ))}
        </svg>
        {[0, 50, 100].map((v) => (
          <span key={v} className="pointer-events-none absolute right-full mr-1.5 -translate-y-1/2 font-mono text-[10px] text-muted" style={{ top: `${((y(v / 100)) / H) * 100}%` }}>{v}</span>
        ))}
        {lines.map(([k, name, v]) => (
          // пороги близко друг к другу — подпись нижнего уходит под его линию, чтобы не налезать
          <span key={k} className={`pointer-events-none absolute right-0 font-mono text-[10px] ${k === 'shot' ? 'text-alert' : 'text-warn'} ${
            k === 'motor' && r.thresholds.shot >= r.thresholds.motor && r.thresholds.shot - r.thresholds.motor < 0.12 ? 'pt-0.5' : '-translate-y-full pb-0.5'}`}
            style={{ top: `${(y(v) / H) * 100}%` }}>
            порог: {name} {num(v * 100, 1)} %
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>0:00</span><span>{fmtS(dur)}</span></div>

      <details className="group mt-4">
        <summary className="cursor-pointer list-none text-[13px] font-medium text-primary/90 hover:text-primary">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>Клип за клипом: что слышит сеть и что решает ухо буя
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-3 font-medium">№</th><th className="pr-3 font-medium">время</th><th className="pr-3 font-medium">сеть слышит</th>
                <th className="pr-3 font-medium">фон · мотор · выстрел · голоса</th><th className="pr-3 font-medium">живость</th><th className="pr-3 font-medium">обычная</th><th className="pr-3 font-medium">непривычность</th>
                <th className="font-medium">решение уха буя</th>
              </tr>
            </thead>
            <tbody>
              {r.clips.map((c) => (
                <tr key={c.i} className={`border-b border-line/60 ${c.alert ? 'bg-alert/10' : ''}`}>
                  <td className="py-1.5 pr-3 font-mono">{c.i}</td>
                  <td className="pr-3 font-mono text-muted">{fmtS(c.start)}–{fmtS(c.end)}</td>
                  <td className="pr-3 font-medium">{EVENT_RU[c.event]} <span className="font-mono text-muted">{pct0(c.confidence)}</span></td>
                  <td className="pr-3 font-mono text-muted">{pct0(c.probs.background)} · <span className="text-warn">{pct0(c.probs.motor)}</span> · <span className="text-alert">{pct0(c.probs.shot)}</span>{c.probs.voice != null && <> · <span style={{ color: VOICE }}>{pct0(c.probs.voice)}</span></>}</td>
                  <td className="pr-3 font-mono">{num(c.activity, 2)}</td>
                  <td className="pr-3 font-mono text-muted">{c.baseline != null ? num(c.baseline, 2) : '—'}</td>
                  <td className={`pr-3 font-mono ${(c.novelty ?? 0) > 1 ? 'text-warn' : 'text-muted'}`}>{c.novelty != null ? num(c.novelty, 2) : '—'}</td>
                  <td className={c.alert ? 'font-semibold text-alert' : 'text-muted'}>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] leading-4 text-muted">Ухо буя здесь начинает с чистого листа: «обычную живость» природы оно узнаёт по первым клипам записи — на настоящем буе она копится часами.</p>
        </div>
      </details>
    </div>
  );
}

export default memo(Timeline);
