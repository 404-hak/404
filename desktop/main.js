// 404 для компьютера (Windows, macOS): дашборд инспектора в своём окне.
// Вся картинка — сам сайт на сервере 404, поэтому приложение обновляется вместе с сайтом.
// Своё у приложения: адрес сервера, экран «нет связи» с переподключением, меню, системные уведомления
// о новых тревогах, микрофон для «Слуха», окно запоминает размер и место.
'use strict';

const { app, BrowserWindow, Menu, Notification, ipcMain, net, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const PKG = require('./package.json');
const { alertText, normalize } = require('./lib');
const APP_ID = 'dev.hak404.dashboard';
const BG = '#0B1628';
const IS_MAC = process.platform === 'darwin';

// ---------- настройки: адрес сервера и окно ----------
const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; }
}
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  try {
    fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
    fs.writeFileSync(CONFIG(), JSON.stringify(next, null, 2));
  } catch (e) { console.error('404: не удалось сохранить настройки', e); }
  return next;
}

const server = () => normalize(readConfig().server || process.env.APP404_SERVER || PKG.serverUrl || '');
const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const isOwn = (u) => !!server() && origin(u) === origin(server());

// ---------- окно ----------
let win = null;
let lastError = '';

function createWindow() {
  const saved = readConfig().window || {};
  win = new BrowserWindow({
    width: saved.width || 1440, height: saved.height || 900, x: saved.x, y: saved.y,
    minWidth: 360, minHeight: 560, backgroundColor: BG, title: '404', show: false,
    autoHideMenuBar: !IS_MAC,                 // на Windows меню прячется, Alt — показать
    icon: IS_MAC ? undefined : path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
      backgroundThrottling: false,            // тревога в фоне не должна ждать, пока окно станет видимым
    },
  });
  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  // метка в User-Agent: сайт знает, что открыт в приложении для компьютера
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} 404Desktop/${PKG.version}`);

  // размер и место окна — запоминаем
  let t = null;
  const remember = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      writeConfig({ window: { ...(win.isMaximized() ? readConfig().window : win.getBounds()), maximized: win.isMaximized() } });
    }, 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', remember);
  win.on('focus', () => win.flashFrame(false));

  // ссылки на чужие сайты — в браузере, свой сервер — в окне
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || isOwn(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });

  // сервер не ответил — свой экран «нет связи» (а не пустое окно)
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;   // -3 — загрузка прервана нами же
    lastError = `${desc} (${code})`;
    showOffline();
  });

  open();
}

function open() {
  if (!win) return;
  const s = server();
  if (s) void win.loadURL(s);
  else showSetup();
}
const showSetup = () => win && win.loadFile(path.join(__dirname, 'pages', 'setup.html'));
const showOffline = () => win && win.loadFile(path.join(__dirname, 'pages', 'offline.html'));

/** Сервер отвечает? Любой HTTP-ответ — да (даже «нужен вход»): сеть есть, дальше разберётся сам сайт. */
async function reachable(u) {
  try {
    const r = await net.fetch(u, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(6000) });
    return r.status > 0;
  } catch (e) {
    lastError = e && e.message ? e.message : String(e);
    return false;
  }
}

// ---------- мост для страниц (preload.js) ----------
ipcMain.handle('app404:config', () => ({
  server: server() || '', version: PKG.version, platform: process.platform, error: lastError,
}));
ipcMain.handle('app404:connect', async (_e, raw) => {
  const u = normalize(raw);
  if (!u) return { ok: false, error: 'Адрес не похож на адрес сервера' };
  writeConfig({ server: u });
  lastError = '';
  if (await reachable(u)) { void win.loadURL(u); return { ok: true }; }
  showOffline();
  return { ok: false, error: lastError };
});
ipcMain.handle('app404:retry', async () => {
  const s = server();
  if (!s) { showSetup(); return false; }
  if (await reachable(s)) { void win.loadURL(s); return true; }
  return false;
});
ipcMain.on('app404:setup', () => showSetup());
ipcMain.on('app404:cancel-setup', () => open());

// новые тревоги — системным уведомлением, мигание кнопки в панели задач, число на значке в доке
ipcMain.on('app404:alert', (e, a) => {
  if (!win || e.sender !== win.webContents || !a || typeof a !== 'object') return;
  const text = alertText(a);
  const title = `404 · ${text.title}`.slice(0, 100);
  const body = text.body.slice(0, 300);
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
    n.show();
  }
  if (!win.isFocused()) win.flashFrame(true);
});
ipcMain.on('app404:badge', (e, count) => {
  if (!win || e.sender !== win.webContents) return;
  const n = Math.max(0, Math.min(99, Number(count) || 0));
  if (IS_MAC || process.platform === 'linux') app.setBadgeCount(n);
});

// ---------- меню ----------
function buildMenu() {
  const nav = [
    { label: 'Сменить сервер…', click: () => showSetup() },
    { label: 'Переподключиться', accelerator: 'CmdOrCtrl+R', click: () => open() },
  ];
  const template = [
    ...(IS_MAC ? [{
      label: '404',
      submenu: [{ role: 'about', label: 'О программе 404' }, { type: 'separator' }, ...nav, { type: 'separator' },
        { role: 'hide', label: 'Скрыть 404' }, { role: 'hideOthers', label: 'Скрыть остальные' }, { role: 'unhide', label: 'Показать все' },
        { type: 'separator' }, { role: 'quit', label: 'Выйти из 404' }],
    }] : [{ label: 'Файл', submenu: [...nav, { type: 'separator' }, { role: 'quit', label: 'Выход' }] }]),
    {
      label: 'Правка',
      submenu: [{ role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' },
        { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }],
    },
    {
      label: 'Вид',
      submenu: [{ role: 'forceReload', label: 'Обновить без кэша' }, { type: 'separator' },
        { role: 'resetZoom', label: 'Обычный масштаб' }, { role: 'zoomIn', label: 'Крупнее' }, { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' }, { role: 'togglefullscreen', label: 'Во весь экран' }, { type: 'separator' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' }],
    },
    { label: 'Окно', submenu: [{ role: 'minimize', label: 'Свернуть' }, { role: 'zoom', label: 'Развернуть' }, ...(IS_MAC ? [{ role: 'front', label: 'Все окна вперёд' }] : [{ role: 'close', label: 'Закрыть' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- запуск ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();                                 // второй экземпляр не нужен — показываем первый
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.setAppUserModelId(APP_ID);              // Windows: без него уведомления не показываются
  app.setAboutPanelOptions({ applicationName: '404', applicationVersion: PKG.version, copyright: 'Браконьер не найден' });

  app.whenReady().then(() => {
    // разрешения — только своему серверу: микрофон («Слух»), уведомления, полноэкранный режим, буфер обмена
    const allowed = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
      const media = permission !== 'media' || (details.mediaTypes || []).every((t) => t === 'audio');
      cb(allowed.has(permission) && media && isOwn(details.requestingUrl || wc.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
      allowed.has(permission) && origin(requestingOrigin) === origin(server() || ''));
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else if (win) win.show(); });
  });
  app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
}

