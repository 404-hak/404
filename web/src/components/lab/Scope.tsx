import { memo, useEffect, useMemo, useRef } from 'react';
import type { PlayerApi } from './player';
import type { LabResult } from '../../lab';
import { fmtS } from '../../lab';

/**
 * «Экран» лаборатории: лог-мел спектрограмма (то, что видит сеть) и волна.
 * Поверх — где в звуке что лежит (для сценариев), границы клипов буя по 4 с, полоса природы,
 * самый резкий удар и бегущая позиция воспроизведения. Клик — слушать с этого места,
 * протянуть с зажатой кнопкой — перемотка «на слух» (звук идёт с того места, где отпустили).
 */

// ночное море → бирюза → шалфей → янтарь → белый: тихое тёмное, громкое светлое
const STOPS: [number, [number, number, number]][] = [
  [0, [6, 13, 26]], [0.22, [16, 44, 78]], [0.45, [36, 112, 122]], [0.65, [150, 178, 120]], [0.83, [242, 190, 98]], [1, [255, 248, 228]],
];
const LUT = (() => {
  const t = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
    const [a, ca] = STOPS[k], [b, cb] = STOPS[k + 1];
    const f = (v - a) / (b - a);
    for (let c = 0; c < 3; c++) t[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * f;
  }
  return t;
})();

const HZ_TICKS = [100, 300, 1000, 3000, 7000];
const hzLabel = (h: number) => (h >= 1000 ? `${h / 1000} кГц` : `${h} Гц`);

/** Доля высоты (0 — низ) для частоты по центрам мел-полос */
function bandPos(mel: number[], hz: number) {
  if (hz <= mel[0]) return 0;
  for (let i = 1; i < mel.length; i++) {
    if (hz <= mel[i]) return (i - 1 + (hz - mel[i - 1]) / (mel[i] - mel[i - 1]) + 0.5) / mel.length;
  }
  return 1;
}

function Scope({ r, player }: { r: LabResult; player: PlayerApi }) {
  const spec = useRef<HTMLCanvasElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const dur = r.duration_s;

  // спектрограмма: кадры × полосы → картинка; браузер растягивает её сглаживая
  useEffect(() => {
    const cv = spec.current;
    if (!cv) return;
    const { frames: T, bands: F, data } = r.spec;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    cv.width = T; cv.height = F;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(T, F);
    for (let t = 0; t < T; t++) {
      for (let f = 0; f < F; f++) {
        const v = bytes[t * F + f], o = ((F - 1 - f) * T + t) * 4;
        img.data[o] = LUT[v * 3]; img.data[o + 1] = LUT[v * 3 + 1]; img.data[o + 2] = LUT[v * 3 + 2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, [r]);

  // волна: минимум и максимум в каждом столбце
  useEffect(() => {
    const cv = wave.current;
    if (!cv) return;
    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const { min, max } = r.wave, n = min.length;
      const col = getComputedStyle(cv).color;
      g.fillStyle = col;
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((x / w) * n), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
        let lo = 1, hi = -1;
        for (let i = i0; i < i1 && i < n; i++) { lo = Math.min(lo, min[i]); hi = Math.max(hi, max[i]); }
        const y0 = h / 2 - hi * (h / 2 - 2), y1 = h / 2 - lo * (h / 2 - 2);
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [r]);

  const ticks = useMemo(() => {
    const step = dur > 20 ? 5 : dur > 8 ? 2 : 1;
    return Array.from({ length: Math.floor(dur / step) + 1 }, (_, i) => i * step).filter((t) => t <= dur);
  }, [dur]);
  const bio = [bandPos(r.spec.mel_hz, r.nature.band_hz[0]), bandPos(r.spec.mel_hz, r.nature.band_hz[1])];

  // перемотка: нажал — позиция, протянул — бегунок едет за пальцем, отпустил — слушаем отсюда
  const drag = useRef<{ was: boolean } | null>(null);
  const timeAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((e.clientX - box.left) / box.width) * dur));
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { was: player.snap().playing };
    player.pause();
    player.seek(timeAt(e));
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => { if (drag.current) player.seek(timeAt(e)); };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    player.seek(timeAt(e));
    player.play();
  };
  const at = (t: number) => `${(t / dur) * 100}%`;

  return (
    <div className="grid grid-cols-[46px_1fr] gap-x-2">
      {/* шкала частот */}
      <div className="relative h-[170px] font-mono text-[10px] text-muted md:h-[230px]">
        {HZ_TICKS.map((h) => (
          <span key={h} className="absolute right-0 whitespace-nowrap" style={{ bottom: `${bandPos(r.spec.mel_hz, h) * 100}%`, transform: 'translateY(50%)' }}>{hzLabel(h)}</span>
        ))}
      </div>
      <div className="relative cursor-crosshair touch-none select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        title="Нажмите — слушать с этого места; протяните — перемотка">
        <div className="relative h-[170px] overflow-hidden rounded-t-[10px] bg-[#060d1a] md:h-[230px]">
          <canvas ref={spec} className="absolute inset-0 h-full w-full" aria-label="Спектрограмма: время по горизонтали, частота по вертикали, яркость — громкость" />
          {/* полоса природы */}
          <div className="pointer-events-none absolute inset-x-0 border-y border-dashed border-[#A9C59A]/45" style={{ bottom: `${bio[0] * 100}%`, top: `${(1 - bio[1]) * 100}%` }}>
            <span className="absolute right-1.5 top-1 rounded-[4px] bg-[#060d1a]/70 px-1 font-mono text-[10px] text-[#C7DDB6]">полоса природы 1,2–7,6 кГц</span>
          </div>
          {/* где что лежит в сценарии */}
          {r.marks.map((m) => (
            <div key={m.label + m.start} className="pointer-events-none absolute top-0 h-[6px] rounded-b-[3px] bg-white/70" style={{ left: at(m.start), width: at(m.end - m.start) }}>
              <span className="absolute left-0 top-2 whitespace-nowrap rounded-[4px] bg-[#060d1a]/75 px-1 text-[10px] font-medium text-white">{m.label}</span>
            </div>
          ))}
          {/* границы клипов буя */}
          {r.clips.slice(1).map((c) => <div key={c.i} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-white/25" style={{ left: at(c.start) }} />)}
          {/* самый резкий удар */}
          <div className="pointer-events-none absolute bottom-0 top-0 border-l border-[#FF8A7A]/70" style={{ left: at(r.impulse.t) }}>
            <span className="absolute -left-[5px] bottom-0 text-[10px] leading-none text-[#FF8A7A]">▲</span>
          </div>
        </div>
        <div className="relative h-[56px] rounded-b-[10px] border border-t-0 border-line bg-bg/60 md:h-[70px]">
          <canvas ref={wave} className="absolute inset-0 h-full w-full text-primary/70" aria-label="Волна звука" />
          {r.clips.slice(1).map((c) => <div key={c.i} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line" style={{ left: at(c.start) }} />)}
        </div>
        {/* позиция воспроизведения — двигается напрямую, без перерисовки React */}
        <div ref={player.bind} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,.8)] will-change-transform" style={{ opacity: 0 }}>
          <span className="absolute -left-[5px] -top-[5px] h-[11px] w-[11px] rounded-full bg-white" />
        </div>
      </div>
      <div />
      <div className="relative mt-1 h-4 font-mono text-[10px] text-muted">
        {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: at(t) }}>{fmtS(t)}</span>)}
      </div>
    </div>
  );
}

// пока играет звук, спектрограмма не перерисовывается: бегунок двигается сам, без React
export default memo(Scope);
