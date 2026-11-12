import { useMemo } from 'react';

/**
 * Камыш и рогоз дельты — общий для интро и фона. Каждый стебель качается сам по себе (CSS).
 * Размытый камыш — `clump`: стебли стоят, а качается весь куст целиком. Так видеокарта размывает
 * его один раз и дальше только поворачивает готовую картинку (иначе размытие пересчитывается каждый кадр).
 */
type Blade = { x: number; h: number; lean: number; w: number; head: boolean; dur: number; delay: number };
function makeBlades(seed: number, count: number): Blade[] {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  return Array.from({ length: count }, () => {
    const x = 8 + r() * 250, h = 230 + r() * 260, lean = 8 + r() * 34 + (r() - 0.5) * 18, w = 5 + r() * 6;
    return { x, h, lean, w, head: r() < 0.35, dur: 5 + r() * 4, delay: -r() * 6 };
  });
}
const bladePath = (b: Blade) => {
  const by = 510;
  return `M${b.x - b.w / 2},${by} Q${b.x + b.lean * 0.3},${by - b.h * 0.55} ${b.x + b.lean},${by - b.h} Q${b.x + b.lean * 0.35 + b.w * 0.4},${by - b.h * 0.5} ${b.x + b.w / 2},${by} Z`;
};

/**
 * Размытый камыш картинкой: браузер рисует и размывает его один раз, дальше только поворачивает
 * готовую текстуру. Для переднего плана интро (сильное размытие) — в разы легче живого SVG с фильтром.
 * `blur` — в единицах рисунка (высота 500).
 */
export function ReedsImage({ side, seed = 7, count = 16, color, blur, className = '', style }: {
  side: 'left' | 'right'; seed?: number; count?: number; color: string; blur: number; className?: string; style?: React.CSSProperties;
}) {
  const src = useMemo(() => {
    const parts = makeBlades(seed, count).map((b) => {
      const head = b.head
        ? `<ellipse cx="${b.x + b.lean * 0.78}" cy="${510 - b.h * 0.8}" rx="${b.w * 0.9}" ry="${b.w * 3.6}" transform="rotate(${b.lean * 0.25} ${b.x + b.lean * 0.78} ${510 - b.h * 0.8})"/>`
        : '';
      return `<path d="${bladePath(b)}"/>${head}`;
    }).join('');
    const pad = Math.ceil(blur * 3);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${300 + 2 * pad} ${500 + pad}" width="${300 + 2 * pad}" height="${500 + pad}">`
      + `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter>`
      + `<g fill="${color}" filter="url(#b)">${parts}</g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [seed, count, color, blur]);
  return (
    <img src={src} alt="" aria-hidden draggable={false} className={`reeds-sway ${className}`}
      style={{ ...style, transform: side === 'right' ? 'scaleX(-1)' : undefined, animationDuration: `${7 + (seed % 5)}s`, animationDelay: `${-(seed % 7)}s`, objectFit: 'contain', objectPosition: side === 'left' ? 'left bottom' : 'right bottom' }} />
  );
}

export default function Reeds({ side, seed = 7, count = 16, className = '', style, clump = false, blur = 0 }: {
  side: 'left' | 'right'; seed?: number; count?: number; className?: string; style?: React.CSSProperties; clump?: boolean;
  /** мягкость краёв в единицах рисунка — фильтром внутри SVG: размывается при отрисовке один раз, не каждый кадр */
  blur?: number;
}) {
  const fid = `reed-blur-${side}-${seed}`;
  const blades = useMemo(() => makeBlades(seed, count), [seed, count]);
  return (
    <svg viewBox="0 0 300 500" preserveAspectRatio={side === 'left' ? 'xMinYMax meet' : 'xMaxYMax meet'}
      className={`${className}${clump ? ' reeds-sway' : ''}`} aria-hidden
      style={{ ...style, transform: side === 'right' ? 'scaleX(-1)' : undefined, animationDuration: clump ? `${7 + (seed % 5)}s` : undefined, animationDelay: clump ? `${-(seed % 7)}s` : undefined }}>
      {blur > 0 && <defs><filter id={fid} x="-20%" y="-10%" width="140%" height="120%"><feGaussianBlur stdDeviation={blur} /></filter></defs>}
      <g filter={blur > 0 ? `url(#${fid})` : undefined}>
        {blades.map((b, i) => {
          const by = 510;
          return (
            <g key={i} className={clump ? undefined : 'reed'} style={clump ? undefined : { animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}>
              <path fill="currentColor" d={bladePath(b)} />
              {b.head && (
                <ellipse fill="currentColor" cx={b.x + b.lean * 0.78} cy={by - b.h * 0.8} rx={b.w * 0.9} ry={b.w * 3.6}
                  transform={`rotate(${b.lean * 0.25} ${b.x + b.lean * 0.78} ${by - b.h * 0.8})`} />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
