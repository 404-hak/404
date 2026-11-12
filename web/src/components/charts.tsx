import { useRef, useState, type ReactNode } from 'react';

/** Подсказка над отметкой графика. */
function Tip({ x, children }: { x: number; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[8px] border border-line bg-bg/95 px-2.5 py-1.5 text-[12px] leading-4 shadow-[0_8px_24px_rgba(0,0,0,.4)]"
      style={{ left: `${Math.min(92, Math.max(8, x))}%` }}>
      {children}
    </div>
  );
}

export interface Bar { key: string; label: string; value: number; tip: ReactNode; strong?: boolean }

/**
 * Столбики одной величины: тонкие, скруглённые сверху, опираются на ось, между ними зазор.
 * Подписи по оси — через `every`, чтобы не налезали. Подсказка при наведении и с клавиатуры.
 */
export function Bars({ data, height = 140, every = 1, label }: { data: Bar[]; height?: number; every?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div className="relative" role="img" aria-label={label}>
      <div className="relative flex gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-white/[.06]" style={{ bottom: `${(t / max) * 100}%` }}>
            <span className="absolute -top-2 right-full mr-1.5 font-mono text-[10px] text-muted">{t}</span>
          </div>
        ))}
        {data.map((d, i) => (
          <button key={d.key} type="button" tabIndex={0} aria-label={`${d.label}: ${d.value}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            className="group relative flex h-full flex-1 items-end outline-none">
            <span className={`bar-grow block w-full rounded-t-[4px] transition-colors ${d.strong ? 'bg-[#C9D4BC]' : 'bg-[#8E9C80]'} ${hover === i ? '!bg-primary' : ''}`}
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0, animationDelay: `${i * 18}ms` }} />
          </button>
        ))}
        {hover != null && <Tip x={((hover + 0.5) / data.length) * 100}>{data[hover].tip}</Tip>}
      </div>
      <div className="mt-1.5 flex gap-[2px] border-t border-white/15 pt-1.5">
        {data.map((d, i) => (
          <span key={d.key} className="flex-1 overflow-visible text-center font-mono text-[10px] text-muted">
            {i % every === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface Pt { key: string; label: string; value: number; tip: ReactNode }

/** Линия с заливкой (0–100 %), перекрестье и подсказка у ближайшей точки. */
export function AreaLine({ data, height = 120, every = 1, label, refLines = [] }: {
  data: Pt[]; height?: number; every?: number; label: string; refLines?: { at: number; text: string }[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 100;
  const x = (i: number) => (data.length < 2 ? W / 2 : (i / (data.length - 1)) * W);
  const y = (v: number) => H - v * H;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)));
  };
  return (
    <div role="img" aria-label={label}>
      <div ref={box} className="relative" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#E2E8F0" stopOpacity=".22" /><stop offset="1" stopColor="#E2E8F0" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((t) => <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke="rgba(226,232,240,.07)" vectorEffect="non-scaling-stroke" />)}
          {refLines.map((r) => (
            <line key={r.at} x1="0" x2={W} y1={y(r.at)} y2={y(r.at)} stroke="rgba(245,158,11,.45)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill="url(#area-fill)" className="fade-in" />
          <path d={line} fill="none" stroke="#E2E8F0" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" pathLength={1} className="line-draw" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="rgba(226,232,240,.35)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {refLines.map((r) => (
          <span key={r.at} className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 text-[10px] text-warn" style={{ top: `${(1 - r.at) * 100}%` }}>{r.text}</span>
        ))}
        {hover != null && data[hover] && (
          <>
            <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-primary"
              style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` }} />
            <Tip x={(x(hover) / W) * 100}>{data[hover].tip}</Tip>
          </>
        )}
        {[0, 50, 100].map((t) => (
          <span key={t} className="pointer-events-none absolute right-full mr-1.5 -translate-y-1/2 font-mono text-[10px] text-muted" style={{ top: `${100 - t}%` }}>{t}</span>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between border-t border-white/15 pt-1.5">
        {data.map((d, i) => (
          <span key={d.key} className="w-0 overflow-visible whitespace-nowrap text-center font-mono text-[10px] text-muted">
            <span className="inline-block -translate-x-1/2">{i % every === 0 ? d.label : ''}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Горизонтальные столбики с подписями и значением справа. */
export function HBars({ data }: { data: { key: string; label: ReactNode; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={d.key}>
          <div className="mb-1 flex items-center justify-between text-[13px]"><span>{d.label}</span><span className="font-mono text-[12px] text-muted">{d.value}</span></div>
          <div className="h-2 rounded-full bg-white/[.06]">
            <div className="bar-grow-x h-full rounded-full bg-[#8E9C80]" style={{ width: `${(d.value / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Сетка 3×3 как сектора на карте: насыщенность — число событий (один оттенок). */
export function HeatGrid({ counts, hot, onPick }: { counts: Record<string, number>; hot: number[]; onPick?: (n: number) => void }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="grid grid-cols-3 gap-[3px] overflow-hidden rounded-[12px]">
      {Array.from({ length: 9 }, (_, k) => k + 1).map((n) => {
        const v = counts[n] ?? 0, k = v / max;
        return (
          <button key={n} type="button" onClick={() => onPick?.(n)} title={`Сектор ${n}: ${v} событий`}
            className="group relative aspect-[4/3] p-2.5 text-left transition-transform hover:z-10 hover:scale-[1.04]"
            style={{ background: `rgba(169,183,156,${(0.05 + k * 0.55).toFixed(3)})` }}>
            <span className={`font-mono text-[11px] ${k > 0.55 ? 'text-bg' : 'text-muted'}`}>{n}</span>
            <span className={`absolute bottom-2 right-2.5 font-mono text-[18px] font-medium ${k > 0.55 ? 'text-bg' : 'text-primary'}`}>{v}</span>
            {hot.includes(n) && <span className="absolute right-2 top-2 rounded-[4px] border border-warn/70 bg-bg/80 px-1 text-[9px] font-semibold uppercase tracking-[.06em] text-warn">риск</span>}
          </button>
        );
      })}
    </div>
  );
}
