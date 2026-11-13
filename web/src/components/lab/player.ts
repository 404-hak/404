import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LabResult } from '../../lab';

/**
 * Проигрыватель лаборатории. Бегунков несколько (спектрограмма, липкая панель, ход по времени) —
 * все они двигаются напрямую через transform, без перерисовки React: каждый кадр только сдвиг.
 * Время для подписей обновляется в состоянии не чаще 10 раз в секунду.
 */
export interface PlayerApi {
  audio: React.RefObject<HTMLAudioElement>;
  /** callback-ref для бегунка: элемент, абсолютно стоящий в контейнере шириной во всю запись */
  bind: (el: HTMLElement | null) => void;
  playing: boolean;
  t: number;
  rate: number;
  loop: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (sec: number) => void;
  nudge: (dsec: number) => void;
  setRate: (r: number) => void;
  setLoop: (v: boolean) => void;
}

export function usePlayer(duration: number, key: string): PlayerApi {
  const audio = useRef<HTMLAudioElement>(null);
  const heads = useRef(new Set<HTMLElement>());
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [rate, setRateS] = useState(1);
  const [loop, setLoopS] = useState(false);
  const dur = useRef(duration);
  dur.current = duration;

  const paint = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    const f = Math.max(0, Math.min(1, a.currentTime / (dur.current || 1)));
    const shown = a.currentTime > 0 || !a.paused;
    for (const h of heads.current) {
      if (!h.isConnected) { heads.current.delete(h); continue; }
      const w = h.parentElement?.clientWidth ?? 0;
      h.style.transform = `translateX(${f * w}px)`;
      h.style.opacity = shown ? '1' : '0';
    }
  }, []);

  const bind = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    heads.current.add(el);
    requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.defaultPlaybackRate = rate;                 // новая запись (смена src) берёт скорость отсюда
    a.playbackRate = rate;
    a.loop = loop;
    setT(0); setPlaying(false);
    let raf = 0, last = -1;
    const tick = () => {
      paint();
      if (Math.abs(a.currentTime - last) > 0.1) { last = a.currentTime; setT(a.currentTime); }
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const on = () => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const off = () => { setPlaying(false); cancelAnimationFrame(raf); last = -1; tick(); };
    const seeked = () => { last = -1; tick(); };
    a.addEventListener('play', on);
    a.addEventListener('pause', off);
    a.addEventListener('ended', off);
    a.addEventListener('seeked', seeked);
    // бегунки заново встают по месту, если поменялась ширина (поворот телефона, свёрнутый лист)
    const ro = new ResizeObserver(() => paint());
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      a.removeEventListener('play', on); a.removeEventListener('pause', off);
      a.removeEventListener('ended', off); a.removeEventListener('seeked', seeked);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<PlayerApi>(() => {
    const play = () => { void audio.current?.play().catch(() => undefined); };
    const pause = () => audio.current?.pause();
    const seek = (sec: number) => {
      const a = audio.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min(dur.current, sec));
      setT(a.currentTime);
      paint();
    };
    return {
      audio, bind, playing, t, rate, loop, play, pause, seek,
      toggle: () => { const a = audio.current; if (!a) return; if (a.paused) play(); else a.pause(); },
      nudge: (d: number) => seek((audio.current?.currentTime ?? 0) + d),
      setRate: (r: number) => { setRateS(r); const a = audio.current; if (a) { a.defaultPlaybackRate = r; a.playbackRate = r; } },
      setLoop: (v: boolean) => { setLoopS(v); if (audio.current) audio.current.loop = v; },
    };
  }, [bind, paint, playing, t, rate, loop]);
}

/** Что сеть слышит в секунду t: ближайшее окно хода по времени (4 с, шаг 0,5 с) и клип буя, в который попадает t. */
export function nowAt(r: Pick<LabResult, 'timeline' | 'classes' | 'clips'>, t: number) {
  let best = r.timeline[0];
  for (const q of r.timeline) if (Math.abs(q.t - t) < Math.abs(best.t - t)) best = q;
  const ev = r.classes.reduce((a, c) => (best[c] > best[a] ? c : a), r.classes[0]);
  const clip = r.clips.find((c) => t >= c.start && t < c.end) ?? r.clips[r.clips.length - 1];
  return { ev, p: best[ev], clip, unfamiliar: (best.novelty ?? 0) > 1 };
}
