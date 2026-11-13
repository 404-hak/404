// «Нет связи»: сам пробует подключиться — сначала часто, потом реже (5 → 30 с); вернулась сеть — сразу.
'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  const cfg = await window.app404.config();
  $('addr').textContent = cfg.server || '';
  $('ver').textContent = `404 · версия ${cfg.version}`;
  if (cfg.error) $('why').textContent = `Сервер не отвечает: ${cfg.error}. Приложение пробует подключиться само.`;

  let wait = 5000, timer = 0, busy = false;
  const attempt = async () => {
    if (busy) return;
    busy = true;
    $('retry').disabled = true;
    $('retry').textContent = 'Подключаюсь…';
    const ok = await window.app404.retry();     // получилось — приложение само откроет дашборд
    busy = false;
    if (ok) return;
    $('retry').disabled = false;
    $('retry').textContent = 'Повторить сейчас';
    clearTimeout(timer);
    timer = setTimeout(attempt, wait);
    wait = Math.min(30000, wait * 1.5);
  };
  $('retry').addEventListener('click', () => { wait = 5000; void attempt(); });
  $('change').addEventListener('click', () => window.app404.setup());
  window.addEventListener('online', () => { wait = 5000; void attempt(); });
  timer = setTimeout(attempt, wait);
})();
