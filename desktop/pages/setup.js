// Экран адреса сервера: первый запуск и «Сменить сервер…».
'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  const cfg = await window.app404.config();
  $('u').value = cfg.server || '';
  $('ver').textContent = `404 · версия ${cfg.version}`;
  if (cfg.server) {
    $('cancel').hidden = false;
    $('cancel').addEventListener('click', () => window.app404.cancelSetup());
  }
  $('u').select();
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const go = $('go');
    go.disabled = true;
    go.textContent = 'Подключаюсь…';
    $('err').textContent = '';
    const r = await window.app404.connect($('u').value);
    if (!r.ok) {
      go.disabled = false;
      go.textContent = 'Подключиться';
      $('err').textContent = r.error || 'Сервер не отвечает';
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cfg.server) window.app404.cancelSetup(); });
})();
