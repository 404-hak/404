import { useEffect, useRef } from 'react';
import TopBar from './components/TopBar';
import MapShell from './components/MapShell';
import SidePanel from './components/SidePanel';
import { api, useLiveState } from './live';
import { plural } from './format';
import type { MapHandle } from './geo';

/** Короткий двухтоновый сигнал тревоги (браузер разрешит звук после первого клика). */
function beep() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.22);
      o.stop(ctx.currentTime + i * 0.22 + 0.21);
    });
  } catch { /* звук недоступен — не критично */ }
}

export default function App() {
  const { state, online } = useLiveState();
  const lastAlert = useRef<string | null>(null);
  const map = useRef<MapHandle | null>(null);

  useEffect(() => {
    const fresh = state?.alerts.find((a) => a.status === 'new');
    if (fresh && lastAlert.current !== null && fresh.id !== lastAlert.current) beep();
    lastAlert.current = fresh?.id ?? lastAlert.current ?? '';
  }, [state]);

  const subtitle = state
    ? `${plural(state.sectors.length, ['сектор', 'сектора', 'секторов'])} · ${plural(state.buoys.length, ['акустический буй', 'акустических буя', 'акустических буёв'])}`
    : '';

  return (
    <div className={`app mode-${online && state ? state.mode : 'calm'} flex h-full flex-col text-primary`}>
      <TopBar mode={state?.mode ?? null} online={online} subtitle={subtitle}
        onDemo={() => api.runDemo()} onReset={() => api.resetDemo()} />
      {state ? (
        <main className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="h-[52vh] shrink-0 md:h-auto md:flex-1">
            <MapShell state={state} handle={map} />
          </div>
          <SidePanel state={state} handle={map} />
        </main>
      ) : (
        <div className="grid flex-1 place-items-center">
          <div className="flex flex-col items-center gap-7">
            <div className="relative grid h-20 w-20 place-items-center">
              <span className="boot-ring" /><span className="boot-ring r2" />
              <img src="/brand/404-logo-cream.svg" alt="" className="h-14 w-auto opacity-90" />
            </div>
            <div className="text-[13px] text-muted">Подключаюсь к буям…</div>
          </div>
        </div>
      )}
    </div>
  );
}
