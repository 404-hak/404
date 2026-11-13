import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LabResult } from '../../lab';

/**
 * Проигрыватель лаборатории. Бегунков несколько (спектрограмма, липкая панель, ход по времени) —
 * все они двигаются напрямую через transform, без перерисовки React: каждый кадр только сдвиг.
 * Сам объект проигрывателя не меняется: время и «играет ли» лежат в маленьком хранилище, и на них
 * подписаны только те, кому они нужны (панель слушателя, подсветка текущего клипа). Поэтому, пока звук
 * играет, спектрограмма, графики и вкладки разбора не перерисовываются. Время — не чаще 10 раз в секунду.
 */
export interface PlayerSnap { t: number; playing: boolean; rate: number; loop: boolean }

export interface PlayerApi {
  audio: React.RefObject<HTMLAudioElement>;
  /** callback-ref для бегунка: элемент, абсолютно стоящий в контейнере шириной во всю запись */
  bind: (el: HTMLElement | null) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (sec: number) => void;
  nudge: (dsec: number) => void;
  setRate: (r: number) => void;
  setLoop: (v: boolean) => void;
  subscribe: (fn: () => void) => () => void;
  snap: () => PlayerSnap;
}

export function usePlayer(duration: number, key: string): PlayerApi {
  const audio = useRef<HTMLAudioElement>(null);
  const heads = useRef(new Set<HTMLElement>());
  const dur = useRef(duration);
  dur.current = duration;
  const store = useRef<{ s: PlayerSnap; fns: Set<() => void> }>({ s: { t: 0, playing: false, rate: 1, loop: false }, fns: new Set() });
  const set = useCallback((patch: Partial<PlayerSnap>) => {
    const st = store.current, next = { ...st.s, ...patch };
    if (next.t === st.s.t && next.playing === st.s.playing && next.rate === st.s.rate && next.loop === st.s.loop) return;
    st.s = next;
    st.fns.forEach((f) => f());
  }, []);

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

  const api = useMemo<PlayerApi>(() => {
    const play = () => { void audio.current?.play().catch(() => undefined); };
    const seek = (sec: number) => {
      const a = audio.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min(dur.current, sec));
      set({ t: a.currentTime });
      paint();
    };
    return {
      audio, play, seek,
      bind: (el) => { if (el) { heads.current.add(el); requestAnimationFrame(paint); } },
      pause: () => audio.current?.pause(),
      toggle: () => { const a = audio.current; if (!a) return; if (a.paused) play(); else a.pause(); },
      nudge: (d) => seek((audio.current?.currentTime ?? 0) + d),
      setRate: (r) => { set({ rate: r }); const a = audio.current; if (a) { a.defaultPlaybackRate = r; a.playbackRate = r; } },
      setLoop: (v) => { set({ loop: v }); if (audio.current) audio.current.loop = v; },
      subscribe: (fn) => { store.current.fns.add(fn); return () => { store.current.fns.delete(fn); }; },
      snap: () => store.current.s,
    };
  }, [paint, set]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const { rate, loop } = store.current.s;
    a.defaultPlaybackRate = rate;                 // новая запись (смена src) берёт скорость отсюда
    a.playbackRate = rate;
    a.loop = loop;
    set({ t: 0, playing: false });
    let raf = 0, last = -1;
    const tick = () => {
      paint();
      if (Math.abs(a.currentTime - last) > 0.1) { last = a.currentTime; set({ t: a.currentTime }); }
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const on = () => { set({ playing: true }); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const off = () => { set({ playing: false }); cancelAnimationFrame(raf); last = -1; tick(); };
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

  return api;
}

/** Подписка на время и состояние проигрывателя — для тех, кому они нужны. */
export function usePlayerState(p: PlayerApi): PlayerSnap {
  return useSyncExternalStore(p.subscribe, p.snap);
}

/** Подписка на одно производное значение (например, номер текущего клипа): перерисовка — только когда оно меняется. */
export function usePlayerSelect<T extends string | number | boolean>(p: PlayerApi, pick: (s: PlayerSnap) => T): T {
  return useSyncExternalStore(p.subscribe, () => pick(p.snap()));
}

/** Что сеть слышит в секунду t: ближайшее окно хода по времени (4 с, шаг 0,5 с) и клип буя, в который попадает t. */
export function nowAt(r: Pick<LabResult, 'timeline' | 'classes' | 'clips'>, t: number) {
  let best = r.timeline[0];
  for (const q of r.timeline) if (Math.abs(q.t - t) < Math.abs(best.t - t)) best = q;
  const ev = r.classes.reduce((a, c) => (best[c] > best[a] ? c : a), r.classes[0]);
  const clip = r.clips.find((c) => t >= c.start && t < c.end) ?? r.clips[r.clips.length - 1];
  return { ev, p: best[ev], clip, unfamiliar: (best.novelty ?? 0) > 1 };
}
