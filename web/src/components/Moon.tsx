/**
 * Луна в текущей фазе: освещённая доля и сторона (растущая — справа, убывающая — слева,
 * как видно в северном полушарии).
 */
export default function Moon({ illumination, phase, size = 18 }: { illumination: number; phase: string; size?: number }) {
  const r = 8;
  const k = Math.min(1, Math.max(0, illumination));
  const waning = /убыва|последн/.test(phase);
  // терминатор — полуэллипс с полуосью rx; при k > 0.5 он выгибается в тёмную сторону
  const rx = Math.abs(1 - 2 * k) * r;
  const litRight = !waning;
  const outer = litRight ? 1 : 0;              // освещённый край: правая или левая полуокружность
  const inner = (k > 0.5) === litRight ? 1 : 0; // куда выгибается терминатор
  const d = k < 0.01 ? '' : k > 0.99
    ? `M10 2 A${r} ${r} 0 1 1 9.99 2 Z`
    : `M10 2 A${r} ${r} 0 0 ${outer} 10 18 A${rx.toFixed(2)} ${r} 0 0 ${inner} 10 2 Z`;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <circle cx="10" cy="10" r={r} style={{ fill: 'rgb(var(--rgb-primary) / .08)', stroke: 'rgb(var(--rgb-primary) / .35)' }} strokeWidth="1" />
      {d && <path d={d} style={{ fill: 'var(--c-primary)' }} />}
    </svg>
  );
}
