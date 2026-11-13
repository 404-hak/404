import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Alert, AlertStatus, ChainCheck, JournalEntry, Me, NightForecast, Role, State, Stats, TeamMember } from './types';
import { introPlaying, onIntroFinished } from './introBus';
import { toast } from './upkUi';

/** Живое состояние: сервер шлёт полный снимок по WebSocket при каждом изменении. */
export function useLiveState() {
  const [state, setState] = useState<State | null>(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: number | undefined;
    let attempts = 0;
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
      ws.onopen = () => { attempts = 0; setOnline(true); };
      ws.onmessage = (e) => take(JSON.parse(e.data));
      ws.onclose = () => {
        setOnline(false);
        // пауза растёт 1 → 2 → 4 … до 30 с: недоступный сервер не засыпается попытками
        if (!stopped) retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++) * (0.8 + Math.random() * 0.4));
      };
      ws.onerror = () => ws?.close();
    };
    // вернулась сеть или вкладка — переподключаемся сразу, не дожидаясь паузы
    const now = () => {
      if (stopped || document.hidden || (ws && ws.readyState <= WebSocket.OPEN)) return;
      window.clearTimeout(retry);
      attempts = 0;
      connect();
    };
    window.addEventListener('online', now);
    document.addEventListener('visibilitychange', now);
    connect();
    return () => {
      stopped = true;
      window.removeEventListener('online', now);
      document.removeEventListener('visibilitychange', now);
      off();
      window.clearTimeout(retry);
      ws?.close();
    };
  }, []);
  return { state, online };
}

const post = (url: string, init?: RequestInit) => fetch(url, { method: 'POST', ...init });
/** Ответ сервера с ошибкой — понятное сообщение; без сети — «Нет связи» (docs/audit/05-frontend.md, W5) */
const sent = (what: string) => (r: Response) => {
  if (r.ok) return r;
  throw new Error(r.status === 401 ? 'Нужен доступ: откройте ссылку доступа ещё раз'
    : r.status === 403 ? `${what}: недоступно на этом сервере` : `${what}: ошибка сервера ${r.status}`);
};
const fail = (e: unknown) => {
  const msg = e instanceof Error && !/fetch|network/i.test(e.message) ? e.message : 'Нет связи с сервером';
  toast(msg, 'error');
};
const get = <T,>(url: string): Promise<T> => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))));
export const api = {
  setAlertStatus: (id: string, status: AlertStatus) =>
    fetch(`/api/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      .then(sent('Не удалось изменить тревогу')).catch(fail),
  runDemo: () => post('/api/demo/run').then(sent('Демо')).catch(fail),
  resetDemo: () => post('/api/demo/reset').then(sent('Сброс демо')).catch(fail),
  stats: (days = 30) => get<Stats>(`/api/stats?days=${days}`),
  nights: (days = 14) => get<NightForecast[]>(`/api/forecast/nights?days=${days}`),
  alerts: (limit = 200) => get<Alert[]>(`/api/alerts?limit=${limit}`),
  verify: () => get<ChainCheck>('/api/evidence/verify'),
  journal: (limit = 60) => get<JournalEntry[]>(`/api/journal?limit=${limit}`),
  team: () => get<TeamMember[]>('/api/users'),
  addMember: (m: { login: string; name: string; role: Role }) =>
    fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) })
      .then(async (r) => (r.ok ? (r.json() as Promise<{ login: string; password: string }>) : Promise.reject(new Error((await r.json().catch(() => ({}))).detail ?? `${r.status}`)))),
  patchMember: (login: string, patch: { role?: Role; disabled?: boolean; reset_password?: boolean }) =>
    fetch(`/api/users/${encodeURIComponent(login)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(async (r) => (r.ok ? (r.json() as Promise<{ login: string; password: string | null }>) : Promise.reject(new Error((await r.json().catch(() => ({}))).detail ?? `${r.status}`)))),
  logout: () => post('/api/auth/logout').then(() => location.reload()),
};

// ---------- кто вошёл: роль решает, какие кнопки видны ----------
const RANK: Record<Role, number> = { observer: 0, duty: 1, senior: 2 };
let me: Me = { login: null, name: 'без входа', role: 'senior', role_title: 'старший', accounts: false };
const meSubs = new Set<() => void>();
export function loadMe() {
  return get<Me>('/api/auth/me').then((m) => { me = m; meSubs.forEach((f) => f()); }).catch(() => {});
}
export const currentMe = () => me;
/** Можно ли с этой ролью: наблюдатель < дежурный < старший */
export const can = (role: Role) => RANK[me.role] >= RANK[role];
export const useMe = () => useSyncExternalStore((f) => { meSubs.add(f); return () => { meSubs.delete(f); }; }, () => me);
