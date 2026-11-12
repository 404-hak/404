import { useMemo } from 'react';

/** Камыш и рогоз дельты — общий для интро и фона. Каждый стебель качается сам по себе (CSS). */
export default function Reeds({ side, seed = 7, count = 16, className = '', style }: {
  side: 'left' | 'right'; seed?: number; count?: number; className?: string; style?: React.CSSProperties;
}) {
  const blades = useMemo(() => {
    let s = seed;
    const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    return Array.from({ length: count }, () => {
      const x = 8 + r() * 250, h = 230 + r() * 260, lean = 8 + r() * 34 + (r() - 0.5) * 18, w = 5 + r() * 6;
      return { x, h, lean, w, head: r() < 0.35, dur: 5 + r() * 4, delay: -r() * 6 };
    });
  }, [seed, count]);
  return (
    <svg viewBox="0 0 300 500" preserveAspectRatio={side === 'left' ? 'xMinYMax meet' : 'xMaxYMax meet'}
      className={className} style={{ ...style, transform: side === 'right' ? 'scaleX(-1)' : undefined }} aria-hidden>
      {blades.map((b, i) => {
        const by = 510, tx = b.x + b.lean, ty = by - b.h;
        return (
          <g key={i} className="reed" style={{ animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}>
            <path fill="currentColor" d={`M${b.x - b.w / 2},${by} Q${b.x + b.lean * 0.3},${by - b.h * 0.55} ${tx},${ty} Q${b.x + b.lean * 0.35 + b.w * 0.4},${by - b.h * 0.5} ${b.x + b.w / 2},${by} Z`} />
            {b.head && (
              <ellipse fill="currentColor" cx={b.x + b.lean * 0.78} cy={by - b.h * 0.8} rx={b.w * 0.9} ry={b.w * 3.6}
                transform={`rotate(${b.lean * 0.25} ${b.x + b.lean * 0.78} ${by - b.h * 0.8})`} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
