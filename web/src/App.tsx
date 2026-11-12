import { useEffect, useRef, useState, type ReactNode } from 'react';
import TopBar from './components/TopBar';
import MapShell from './components/MapShell';
import SidePanel from './components/SidePanel';
import Ambient from './components/Ambient';
import { BottomNav, Sidebar } from './components/Nav';
import AlertsPage from './pages/AlertsPage';
import StatsPage from './pages/StatsPage';
import ForecastPage from './pages/ForecastPage';
import BuoysPage from './pages/BuoysPage';
import EvidencePage from './pages/EvidencePage';
import { api, useLiveState } from './live';
import { plural } from './format';
import type { MapHandle } from './geo';
import { useRoute, type Route } from './route';
import { sound } from './sound';
import { useSurfaces } from './motion';
import Intro from './components/Intro';
import { INTRO_EVENT } from './introBus';

/** Интро — один раз за сеанс; ?intro в адресе показывает всегда; при «уменьшить движение» — не показываем */
function introWanted() {
  try {
    if (new URLSearchParams(location.search).has('intro')) return true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return sessionStorage.getItem('404-intro') !== 'seen';
  } catch {
    return true;
  }
}


export default function App() {
  const { state, online } = useLiveState();
  const [route, go] = useRoute();
  const lastAlert = useRef<string | null>(null);
  const map = useRef<MapHandle | null>(null);
  const pendingFly = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [intro, setIntro] = useState(introWanted);
  useSurfaces();
  useEffect(() => {
    const show = () => setIntro(true);
    window.addEventListener(INTRO_EVENT, show);
    return () => window.removeEventListener(INTRO_EVENT, show);
  }, []);

  // новая тревога важнее выбранного буя; Esc снимает выделение
  const freshId = state?.alerts.find((a) => a.status === 'new')?.id;
  useEffect(() => { if (freshId) setSelected(null); }, [freshId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // звук тревоги на каждую новую
  useEffect(() => {
    const fresh = state?.alerts.find((a) => a.status === 'new');
    if (fresh && lastAlert.current !== null && fresh.id !== lastAlert.current) sound.alarm();
    lastAlert.current = fresh?.id ?? lastAlert.current ?? '';
  }, [state]);

  const navigate = (r: Route) => { if (r !== route) sound.tick(); go(r); };
  const select = (id: string | null) => { if (id && id !== selected) sound.ping(); setSelected(id); };

  // из любого раздела — к бую на карте: карта монтируется, затем подлетает
  const toBuoy = (id: string) => { select(id); pendingFly.current = id; navigate('map'); };
  useEffect(() => {
    if (route !== 'map' || !pendingFly.current || !state) return;
    const b = state.buoys.find((x) => x.id === pendingFly.current);
    let tries = 0;
    const t = window.setInterval(() => {
      if (map.current && b) { map.current.flyTo(b.lat, b.lon, 12); window.clearInterval(t); pendingFly.current = null; }
      if (++tries > 40) window.clearInterval(t);
    }, 100);
    return () => window.clearInterval(t);
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = state?.alerts.filter((a) => a.status !== 'resolved').length ?? 0;
  const badges: Partial<Record<Route, ReactNode>> = open
    ? { alerts: <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-alert px-1 font-mono text-[10px] font-semibold text-bg">{open}</span> }
    : {};
  const subtitle = state
    ? `${plural(state.sectors.length, ['сектор', 'сектора', 'секторов'])} · ${plural(state.buoys.length, ['буй', 'буя', 'буёв'])}`
    : '';
  const mode = online && state ? state.mode : 'calm';

  let page: ReactNode = null;
  if (state) {
    page = {
      map: (
        <div className="flex h-full min-h-0 flex-col md:flex-row">
          <div className="h-[48vh] shrink-0 md:h-auto md:flex-1">
            <MapShell state={state} handle={map} selected={selected} onSelect={select} />
          </div>
          <SidePanel state={state} handle={map} selected={selected} onSelect={select} />
        </div>
      ),
      alerts: <AlertsPage state={state} toBuoy={toBuoy} />,
      stats: <StatsPage state={state} />,
      forecast: <ForecastPage />,
      buoys: <BuoysPage state={state} toBuoy={toBuoy} />,
      evidence: <EvidencePage state={state} />,
    }[route];
  }

  return (
    <div className={`app mode-${mode} relative flex h-full text-primary`}>
      <Ambient mode={mode} quiet={route === 'map'} moon={state?.forecast.moon_illumination ?? 0.3} />
      <Sidebar route={route} go={navigate} badges={badges} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar mode={state?.mode ?? null} online={online} title={route === 'map' ? 'Дельта Волги · дежурство' : 'Дельта Волги'} subtitle={subtitle}
          onDemo={() => { navigate('map'); api.runDemo(); }} onReset={() => api.resetDemo()} />
        {state ? (
          <main key={route} className="page-in min-h-0 flex-1">{page}</main>
        ) : (
          <div className="grid flex-1 place-items-center">
            <div className="-mt-8 flex flex-col items-center gap-3">
              {/* знак на воде: едва покачивается, под ним дрожит отражение */}
              <div className="flex flex-col items-center">
                <img src="/brand/404-logo-cream.svg" alt="" className="on-night bob h-14 w-auto opacity-90" />
                <img src="/brand/404-logo-dark.svg" alt="" className="on-day bob h-14 w-auto opacity-90" />
                <div className="mt-1 h-px w-24 bg-gradient-to-r from-transparent via-[#96B4CD]/50 to-transparent" />
                <img src="/brand/404-logo-cream.svg" alt="" aria-hidden className="on-night reflect h-14 w-auto" />
                <img src="/brand/404-logo-dark.svg" alt="" aria-hidden className="on-day reflect h-14 w-auto" />
              </div>
              <div className="text-[13px] text-muted">Подключаюсь к буям…</div>
            </div>
          </div>
        )}
        <BottomNav route={route} go={navigate} badges={badges} />
      </div>
      {intro && (
        <Intro onDone={() => {
          try { sessionStorage.setItem('404-intro', 'seen'); } catch { /* приватный режим */ }
          setIntro(false);
        }} />
      )}
    </div>
  );
}
