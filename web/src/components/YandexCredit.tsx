import { useEffect, useState } from 'react';

/**
 * Подпись Яндекс Карт в нашем оформлении. Родная (белая плашка «Data © GeoEye», «Условия», логотип-ссылка
 * с системной строкой адреса) спрятана CSS; здесь — то же содержание: поставщик снимка, «Яндекс Карты»
 * и ссылка на условия использования — их показывать обязательно по правилам Яндекса.
 * Текст поставщика берётся из скрытой подписи Яндекса и меняется вместе с картой.
 */
export default function YandexCredit({ host }: { host: HTMLElement | null }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!host) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = host.querySelector('[class*="copyright__content"]');
      const t = (el?.textContent ?? '').replace(/\s+/g, ' ').replace(/^©\s*Яндекс,?\s*/i, '').trim();
      setText((prev) => (prev === t ? prev : t));
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(read); });
    mo.observe(host, { subtree: true, childList: true, characterData: true });
    read();
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [host]);
  return (
    <span className="ycredit">
      {text && <>{text} · </>}
      <a href="https://yandex.ru/legal/maps_termsofuse/" target="_blank" rel="noopener noreferrer">Яндекс Карты · условия</a>
    </span>
  );
}
