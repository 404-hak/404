import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Звук-улика — свой проигрыватель вместо серого браузерного: круглая кнопка-буй, дорожка —
 * настоящая форма звука (громкость по времени), прослушанное наливается светом, по дорожке
 * можно вести мышью или пальцем, стрелки — ±1 с, пробел — пауза. Пока звучит, буй «слушает» кольцами.
 */
const BARS = 56;

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/** Пока форма не посчитана (или звук не скачался) — мягкая волна */
const calm = () => Array.from({ length: BARS }, (_, i) => 0.28 + 0.22 * Math.sin(i * 0.55) ** 2 + 0.1 * Math.sin(i * 1.7) ** 2);

async function peaksOf(src: string, signal: AbortSignal) {
  const buf = await (await fetch(src, { signal })).arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const out: number[] = [];
    for (let b = 0; b < BARS; b++) {
      let sum = 0;
      for (let i = b * step; i < Math.min(data.length, (b + 1) * step); i++) sum += data[i] * data[i];
      out.push(Math.sqrt(sum / step));
    }
    const max = Math.max(...out, 1e-6);
    return out.map((v) => 0.12 + 0.88 * Math.pow(v / max, 0.7));
  } finally {
    void ctx.close();
  }
}

export default function Clip({ src, label = 'Звук-улика', compact = false }: { src: string; label?: string; compact?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[]>(calm);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const dragging = useRef(false);

  // форма звука: скачиваем один раз, когда проигрыватель показан
  useEffect(() => {
    const ab = new AbortController();
    peaksOf(src, ab.signal).then((p) => { setPeaks(p); setReady(true); }).catch(() => setReady(true));
    return () => ab.abort();
  }, [src]);

  // прогресс — каждый кадр, пока играет: свет по дорожке идёт плавно, а не скачками timeupdate
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a) { setT(a.currentTime); fill.current?.style.setProperty('--p', String(a.duration ? a.currentTime / a.duration : 0)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false)); else a.pause();
  };
  const seekTo = (k: number) => {
    const a = audio.current;
    if (!a || !a.duration) return;
    a.currentTime = Math.max(0, Math.min(1, k)) * a.duration;
    setT(a.currentTime);
    fill.current?.style.setProperty('--p', String(a.currentTime / a.duration));
  };
  const at = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    seekTo(at(e));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current!.getBoundingClientRect();
    track.current!.style.setProperty('--hover', String(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))));
    if (dragging.current) seekTo(at(e));
  };
  const onUp = () => { dragging.current = false; };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const a = audio.current;
    if (!a) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + (e.key === 'ArrowRight' ? 1 : -1))); setT(a.currentTime); fill.current?.style.setProperty('--p', String(a.duration ? a.currentTime / a.duration : 0)); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };
  const k = dur ? t / dur : 0;

  return (
    <div className={`clip ${playing ? 'is-playing' : ''} ${ready ? 'is-ready' : ''} ${compact ? 'is-compact' : ''}`} data-src={src}>
      <button type="button" className="clip-play" onClick={toggle} aria-label={playing ? 'Пауза' : `Слушать: ${label}`} title={playing ? 'Пауза' : 'Слушать'}>
        <i aria-hidden /><i aria-hidden />
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          {playing ? <path d="M5.2 3.5v9M10.8 3.5v9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> : <path d="M5.5 3.2v9.6L13 8z" fill="currentColor" />}
        </svg>
      </button>
      <div ref={track} className="clip-wave" role="slider" tabIndex={0} aria-label={`${label}: позиция`} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)}
        aria-valuetext={`${fmt(t)} из ${fmt(dur)}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        onPointerLeave={() => track.current?.style.removeProperty('--hover')}>
        <div className="clip-bars" aria-hidden>{peaks.map((v, i) => <span key={i} style={{ height: `${Math.round(v * 100)}%`, transitionDelay: `${i * 6}ms` }} />)}</div>
        <div ref={fill} className="clip-bars clip-fill" aria-hidden style={{ ['--p' as string]: String(k) }}>{peaks.map((v, i) => <span key={i} style={{ height: `${Math.round(v * 100)}%` }} />)}</div>
        <span className="clip-head" aria-hidden style={{ left: `calc(${k * 100}% - 1px)` }} />
      </div>
      <span className="clip-time" aria-hidden>{fmt(t)} / {fmt(dur)}</span>
      <audio ref={audio} src={src} preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={(e) => { setPlaying(false); setT(e.currentTarget.duration); fill.current?.style.setProperty('--p', '1'); }} />
    </div>
  );
}
