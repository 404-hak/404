import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import MapView from './components/MapView';
import SidePanel from './components/SidePanel';
import StatChips from './components/StatChips';
import YandexMapView from './components/YandexMapView';
import { api, useLiveState } from './live';
import { hasYandexKey } from './yandex';

export type Basemap = 'yandex' | 'scheme';

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
  const [basemap, setBasemap] = useState<Basemap>(hasYandexKey ? 'yandex' : 'scheme');
  const [notice, setNotice] = useState<string | null>(null);
  const lastAlert = useRef<string | null>(null);

  useEffect(() => {
    const fresh = state?.alerts.find((a) => a.status === 'new');
    if (fresh && lastAlert.current !== null && fresh.id !== lastAlert.current) beep();
    lastAlert.current = fresh?.id ?? lastAlert.current ?? '';
  }, [state]);

  return (
    <div className="flex h-full flex-col bg-bg text-primary">
      <TopBar mode={state?.mode ?? null} online={online} basemap={basemap} yandexAvailable={hasYandexKey}
        onBasemap={(b) => { setNotice(null); setBasemap(b); }}
        onDemo={() => api.runDemo()} onReset={() => api.resetDemo()} />
      {state ? (
        <main className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative h-[55vh] md:h-auto md:flex-1">
            {basemap === 'yandex' ? (
              <YandexMapView state={state} onFail={(why) => {
                setBasemap('scheme');
                setNotice(`Яндекс Карты недоступны: ${why}. Показана офлайн-схема — кнопка «Яндекс» в шапке попробует снова.`);
              }} />
            ) : (
              <MapView state={state} />
            )}
            {notice && (
              <div className="absolute right-3 top-3 z-[1100] max-w-[340px] rounded-[9px] border border-line bg-surface/95 px-3 py-2 text-[12px] leading-[17px] text-muted">
                {notice}
              </div>
            )}
            <StatChips state={state} raised={basemap === 'yandex'} />
          </div>
          <SidePanel state={state} />
        </main>
      ) : (
        <div className="grid flex-1 place-items-center text-[14px] text-muted">Подключаюсь к серверу…</div>
      )}
    </div>
  );
}
