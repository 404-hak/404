/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { hasYandexKey, loadYmaps } from '../yandex';

/**
 * Снимок места тревоги со спутника — сразу видно, что там: протока, камыш, берег, лодка у берега.
 * Если есть ключ Яндекс Карт — спутник Яндекса (тот же, что у кнопки «Спутник»),
 * без ключа или если Яндекс не ответил — снимки Esri World Imagery.
 * Снимок архивный, не прямой эфир: сам звук и время — в карточке тревоги.
 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

type Phase = 'loading' | 'ready' | 'fail';

/** Ширина кадра в метрах: Меркатор, метров на пиксель на этой широте и масштабе */
function spanLabel(lat: number, zoom: number, px: number) {
  const m = (156543.03 * Math.cos((lat * Math.PI) / 180) / 2 ** zoom) * px;
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} км` : `${Math.round(m / 50) * 50} м`;
}

function Imagery({ lat, lon, zoom, interactive, onPhase }: { lat: number; lon: number; zoom: number; interactive: boolean; onPhase: (p: Phase, by?: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = el.current;
    if (!host) return;
    let dead = false;
    let destroy = () => {};

    const esri = () => {
      if (dead) return;
      // крупно можно только приближать — вокруг центра, чтобы метка тревоги оставалась на месте
      const z = interactive ? 'center' as const : false;
      const m = L.map(host, {
        zoomControl: interactive, attributionControl: true, dragging: false, scrollWheelZoom: z,
        doubleClickZoom: z, touchZoom: z, boxZoom: false, keyboard: false, zoomSnap: 0.5, minZoom: 12, maxZoom: 18,
      }).setView([lat, lon], zoom);
      m.attributionControl.setPrefix(false);
      let ok = 0, bad = 0;
      L.tileLayer(ESRI, { maxZoom: 18, attribution: 'Снимок © Esri, Maxar' })
        .on('tileload', () => { if (!ok++) onPhase('ready', 'esri'); })
        .on('tileerror', () => { if (++bad >= 4 && !ok) onPhase('fail'); })
        .addTo(m);
      destroy = () => m.remove();
    };

    if (hasYandexKey) {
      loadYmaps(10000).then((y) => {
        if (dead) return;
        const m = new y.Map(host, { center: [lat, lon], zoom, type: 'yandex#satellite', controls: interactive ? ['zoomControl'] : [] },
          { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true });
        // метка тревоги стоит в центре: снимок не двигается, крупно — только кнопки масштаба
        m.behaviors.disable(['drag', 'scrollZoom', 'dblClickZoom', 'multiTouch', 'rightMouseButtonMagnifier']);
        onPhase('ready', 'yandex');
        destroy = () => m.destroy();
      }).catch(esri);
    } else esri();

    return () => { dead = true; destroy(); };
  }, [lat, lon, zoom, interactive]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="absolute inset-0" />;
}

/** Метка места: кольцо буя и круги, расходящиеся по воде */
const Mark = ({ tone }: { tone: 'alert' | 'warn' }) => (
  <span className={`sat-mark is-${tone}`} aria-hidden><i /><i /><i /><b /></span>
);

export default function SatSnap({ lat, lon, title, tone = 'alert', zoom = 15, height = 176 }: {
  lat: number; lon: number; title: string; tone?: 'alert' | 'warn'; zoom?: number; height?: number;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [big, setBig] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  useEffect(() => { if (box.current) setW(box.current.offsetWidth); }, []);

  return (
    <>
      <div ref={box} className={`sat-snap is-${phase}`} style={{ height }}>
        <Imagery lat={lat} lon={lon} zoom={zoom} interactive={false} onPhase={(p) => setPhase(p)} />
        <Mark tone={tone} />
        <span className="sat-cap">Спутник · кадр ≈ {spanLabel(lat, zoom, w)}</span>
        {phase === 'loading' && <span className="sat-note">Загружаю снимок…</span>}
        {phase === 'fail' && <span className="sat-note">Снимок не загрузился — нет интернета. Звук и место тревоги — ниже.</span>}
        <button type="button" className="sat-open" onClick={() => setBig(true)} aria-label={`Открыть снимок крупно: ${title}`} title="Открыть крупно">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
          </svg>
        </button>
      </div>
      {big && <SatBig lat={lat} lon={lon} title={title} tone={tone} onClose={() => setBig(false)} />}
    </>
  );
}

/** Снимок на весь экран: можно приблизить и подвинуть */
function SatBig({ lat, lon, title, tone, onClose }: { lat: number; lon: number; title: string; tone: 'alert' | 'warn'; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="sat-big" role="dialog" aria-modal="true" aria-label={`Снимок со спутника: ${title}`} onClick={onClose}>
      <div className={`sat-big-frame is-${phase}`} onClick={(e) => e.stopPropagation()}>
        <Imagery lat={lat} lon={lon} zoom={16} interactive onPhase={(p) => setPhase(p)} />
        <Mark tone={tone} />
        <div className="sat-big-head">
          <span>{title}</span>
          <button type="button" className="ui-btn ui-btn-soft ui-btn-sm" onClick={onClose}>Закрыть</button>
        </div>
        {phase === 'fail' && <span className="sat-note">Снимок не загрузился — нет интернета.</span>}
      </div>
    </div>,
    document.body,
  );
}
