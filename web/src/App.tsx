import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import MapView from './components/MapView';
import SidePanel from './components/SidePanel';
import StatChips from './components/StatChips';
import { api, useLiveState } from './live';

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
  const [basemap, setBasemap] = useState<'scheme' | 'tiles'>('scheme');
  const lastAlert = useRef<string | null>(null);

  useEffect(() => {
    const fresh = state?.alerts.find((a) => a.status === 'new');
    if (fresh && lastAlert.current !== null && fresh.id !== lastAlert.current) beep();
    lastAlert.current = fresh?.id ?? lastAlert.current ?? '';
  }, [state]);

  return (
    <div className="flex h-full flex-col bg-bg text-primary">
      <TopBar mode={state?.mode ?? null} online={online} basemap={basemap} onBasemap={setBasemap}
        onDemo={() => api.runDemo()} onReset={() => api.resetDemo()} />
      {state ? (
        <main className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative h-[55vh] md:h-auto md:flex-1">
            <MapView state={state} basemap={basemap} />
            <StatChips state={state} />
          </div>
          <SidePanel state={state} />
        </main>
      ) : (
        <div className="grid flex-1 place-items-center text-[14px] text-muted">Подключаюсь к серверу…</div>
      )}
    </div>
  );
}
