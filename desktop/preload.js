// Мост между страницей и приложением. Страницы приложения (адрес сервера, «нет связи») зовут window.app404;
// на сайте сервера тот же мост сообщает о новых тревогах — приложение показывает системное уведомление.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app404', {
  desktop: true,
  config: () => ipcRenderer.invoke('app404:config'),
  connect: (url) => ipcRenderer.invoke('app404:connect', String(url)),
  retry: () => ipcRenderer.invoke('app404:retry'),
  setup: () => ipcRenderer.send('app404:setup'),
  cancelSetup: () => ipcRenderer.send('app404:cancel-setup'),
  alert: (a) => ipcRenderer.send('app404:alert', a),
  badge: (n) => ipcRenderer.send('app404:badge', n),
});

// Сайт получает состояние по WebSocket /ws (полный снимок при каждом изменении). Слушаем те же сообщения,
// не меняя сайт: новая открытая тревога — уведомление, число открытых — значок в доке.
// Код ставится в мир страницы до её собственных скриптов, поэтому видит и первое подключение.
function watchAlerts() {
  if (window.__app404Watch) return;
  window.__app404Watch = true;
  const Native = window.WebSocket;
  const seen = new Set();
  let first = true;
  const check = (s) => {
    const open = (s && Array.isArray(s.alerts) ? s.alerts : []).filter((a) => a && a.status !== 'resolved' && !a.synthetic);
    if (first) { open.forEach((a) => seen.add(a.id)); first = false; }      // то, что было до запуска, — не новость
    else {
      for (const a of open) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        window.app404.alert({ kind: a.kind, buoy_name: a.buoy_name, message: a.message, confidence: a.confidence });
      }
    }
    window.app404.badge(open.length);
  };
  class Watched extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      if (/\/ws(\?|$)/.test(String(url))) {
        this.addEventListener('message', (e) => { try { check(JSON.parse(e.data)); } catch { /* не снимок — пропускаем */ } });
      }
    }
  }
  window.WebSocket = Watched;
}

if (/^https?:$/.test(location.protocol)) {
  contextBridge.executeInMainWorld({ func: watchAlerts });
}
