/* eslint-disable @typescript-eslint/no-explicit-any */
// Загрузчик JavaScript API Яндекс Карт 2.1 (официальный способ — тайлы напрямую брать нельзя)
const KEY = import.meta.env.VITE_YANDEX_MAPS_KEY?.trim();
export const hasYandexKey = Boolean(KEY);

let loading: Promise<any> | null = null;

const HINT = 'проверьте ключ JavaScript API, ограничение по адресу сайта в кабинете Яндекса; новый ключ может заработать не сразу';

export function loadYmaps(timeoutMs = 15000): Promise<any> {
  if (!KEY) return Promise.reject(new Error('нет ключа VITE_YANDEX_MAPS_KEY'));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as any;
    let script: HTMLScriptElement | null = null;
    const fail = (why: string) => {
      window.clearTimeout(timer);
      loading = null;
      script?.remove();            // повторная попытка загрузит API заново
      console.warn('[404] Яндекс Карты:', why);
      reject(new Error(why));
    };
    const timer = window.setTimeout(() => fail(`Яндекс не ответил за ${timeoutMs / 1000} с — ${HINT}`), timeoutMs);
    const ready = () => {
      if (!w.ymaps?.ready) return fail(`Яндекс не выдал API — ${HINT}`);
      w.ymaps.ready(
        () => { window.clearTimeout(timer); resolve(w.ymaps); },
        (e: any) => fail(`ответ Яндекса: ${String(e?.message ?? e)} — ${HINT}`),
      );
    };
    if (w.ymaps?.ready) return ready();
    script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(KEY)}&lang=ru_RU`;
    script.async = true;
    script.onload = ready;
    script.onerror = () => fail(`Яндекс отклонил запрос или нет интернета — ${HINT}`);
    document.head.appendChild(script);
  });
  return loading;
}
