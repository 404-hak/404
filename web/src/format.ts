const TZ = 'Europe/Astrakhan';
const time = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dm = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const day = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtTime = (iso: string | Date) => time.format(new Date(iso));
export const fmtHM = (iso: string | Date) => hm.format(new Date(iso));
export const fmtDM = (iso: string | Date) => dm.format(new Date(iso));
export const isToday = (iso: string, now: string) => day.format(new Date(iso)) === day.format(new Date(now));
export const km = (d: number) => `${d.toFixed(1).replace('.', ',')}\u00a0км`;
export const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
export const coord = (lat: number, lon: number) => `${lat.toFixed(4)}° N ${lon.toFixed(4)}° E`;
export const shortHash = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

export const KIND_TITLE: Record<string, string> = {
  motor: 'Мотор', shot: 'Выстрел', silence: 'Тишина как улика', offline: 'Буй молчит',
};
