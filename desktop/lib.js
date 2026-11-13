// Чистые функции приложения для компьютера — их проверяет `npm test` без запуска Electron.
'use strict';

/** «name-8000.app.github.dev» → https://…, «192.168.1.5:8000» → http://… (как в приложении для iPhone) */
function normalize(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!s.includes('://')) {
    const host = s.split('/')[0].split(':')[0];
    const local = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || host.endsWith('.local');
    s = (local ? 'http://' : 'https://') + s;
  }
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const KIND = { motor: 'мотор', shot: 'выстрел', silence: 'тишина как улика', offline: 'буй не на связи' };

/** Текст системного уведомления о тревоге из записи тревоги сайта. */
function alertText(a) {
  const kind = KIND[a.kind] || String(a.kind || 'тревога');
  const title = `Тревога: ${kind} — ${a.buoy_name || 'буй'}`;
  const sure = typeof a.confidence === 'number' && (a.kind === 'motor' || a.kind === 'shot') ? ` Уверенность ${Math.round(a.confidence * 100)} %.` : '';
  return { title, body: `${a.message || ''}${sure}`.trim() };
}

module.exports = { normalize, alertText };
