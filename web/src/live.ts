import { useEffect, useState } from 'react';
import type { AlertStatus, State } from './types';

/** Живое состояние: сервер шлёт полный снимок по WebSocket при каждом изменении. */
export function useLiveState() {
  const [state, setState] = useState<State | null>(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: number | undefined;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setOnline(true);
      ws.onmessage = (e) => setState(JSON.parse(e.data));
      ws.onclose = () => {
        setOnline(false);
        if (!stopped) retry = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      ws?.close();
    };
  }, []);
  return { state, online };
}

const post = (url: string, init?: RequestInit) => fetch(url, { method: 'POST', ...init });
export const api = {
  setAlertStatus: (id: string, status: AlertStatus) =>
    fetch(`/api/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
  runDemo: () => post('/api/demo/run'),
  resetDemo: () => post('/api/demo/reset'),
};
