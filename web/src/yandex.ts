/* eslint-disable @typescript-eslint/no-explicit-any */
// Загрузчик JavaScript API Яндекс Карт 2.1 (официальный способ — тайлы напрямую брать нельзя)
const KEY = import.meta.env.VITE_YANDEX_MAPS_KEY?.trim();
export const hasYandexKey = Boolean(KEY);

let loading: Promise<any> | null = null;

export function loadYmaps(timeoutMs = 12000): Promise<any> {
  if (!KEY) return Promise.reject(new Error('нет ключа VITE_YANDEX_MAPS_KEY'));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as any;
    const fail = (why: string) => { loading = null; reject(new Error(why)); };
    const timer = window.setTimeout(() => fail('Яндекс Карты не ответили'), timeoutMs);
    const ready = () => w.ymaps.ready(
      () => { window.clearTimeout(timer); resolve(w.ymaps); },
      (e: any) => { window.clearTimeout(timer); fail(String(e?.message ?? e)); },
    );
    if (w.ymaps) return ready();
    const s = document.createElement('script');
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(KEY)}&lang=ru_RU`;
    s.async = true;
    s.onload = ready;
    s.onerror = () => { window.clearTimeout(timer); fail('не удалось загрузить Яндекс Карты'); };
    document.head.appendChild(s);
  });
  return loading;
}
