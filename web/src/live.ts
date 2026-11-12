import { useEffect, useState } from 'react';
import type { Alert, AlertStatus, ChainCheck, NightForecast, State, Stats } from './types';
import { introPlaying, onIntroFinished } from './introBus';

/** Живое состояние: сервер шлёт полный снимок по WebSocket при каждом изменении. */
export function useLiveState() {
  const [state, setState] = useState<State | null>(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: number | undefined;
    // пока заставка на экране, свежие снимки копятся (берём последний) и применяются, когда она ушла:
    // перерисовка дашборда под заставкой отнимала у неё кадры
    let held: State | null = null, first = true;
    const off = onIntroFinished(() => { if (held) { setState(held); held = null; } });
    const take = (s: State) => {
      if (introPlaying() && !first) { held = s; return; }
      first = false;
      setState(s);
    };
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setOnline(true);
      ws.onmessage = (e) => take(JSON.parse(e.data));
      ws.onclose = () => {
        setOnline(false);
        if (!stopped) retry = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      stopped = true;
      off();
      window.clearTimeout(retry);
      ws?.close();
    };
  }, []);
  return { state, online };
}

const post = (url: string, init?: RequestInit) => fetch(url, { method: 'POST', ...init });
const get = <T,>(url: string): Promise<T> => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))));
export const api = {
  setAlertStatus: (id: string, status: AlertStatus) =>
    fetch(`/api/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
  runDemo: () => post('/api/demo/run'),
  resetDemo: () => post('/api/demo/reset'),
  stats: (days = 30) => get<Stats>(`/api/stats?days=${days}`),
  nights: (days = 14) => get<NightForecast[]>(`/api/forecast/nights?days=${days}`),
  alerts: (limit = 200) => get<Alert[]>(`/api/alerts?limit=${limit}`),
  verify: () => get<ChainCheck>('/api/evidence/verify'),
};
