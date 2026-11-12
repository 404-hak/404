/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import type { State } from '../types';
import { km } from '../format';
import { loadYmaps } from '../yandex';

const C = { accent: '#7A866F', warn: '#F59E0B', alert: '#EF4444', primary: '#E2E8F0' };

/**
 * Яндекс Карты в режиме «Гибрид»: спутниковый снимок дельты, при приближении видны протоки и камыш.
 * Поверх — слой 404: сектора, «нервы» сети, буи, катер инспектора и маршрут перехвата.
 */
export default function YandexMapView({ state, onFail }: { state: State; onFail: (why: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const ym = useRef<any>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const layouts = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);

  // создание карты
  useEffect(() => {
    let alive = true;
    loadYmaps()
      .then((y) => {
        if (!alive || !el.current) return;
        ym.current = y;
        const m = new y.Map(el.current, {
          center: state.center, zoom: 10, type: 'yandex#hybrid',
          controls: ['zoomControl', 'typeSelector', 'fullscreenControl'],
        }, { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true, minZoom: 7 });
        layouts.current = {
          buoy: y.templateLayoutFactory.createClass(
            '<div class="buoy buoy--{{ properties.status }}">{% if properties.status == "alert" %}<span class="pulse"></span><span class="pulse p2"></span>{% endif %}</div>'),
          inspector: y.templateLayoutFactory.createClass('<div class="inspector"></div>'),
          sector: y.templateLayoutFactory.createClass('<div class="sector-label {{ properties.hot }}">{{ properties.n }}</div>'),
          label: y.templateLayoutFactory.createClass('<div class="route-label">{{ properties.text }}</div>'),
        };
        layer.current = new y.GeoObjectCollection();
        m.geoObjects.add(layer.current);
        map.current = m;
        setReady(true);
      })
      .catch((e) => alive && onFail(String(e?.message ?? e)));
    return () => {
      alive = false;
      map.current?.destroy();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // слой 404 перерисовывается только при смене статусов, горячих секторов или активных алертов
  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];
  const active = state.alerts.filter((a) => a.status !== 'resolved');
  const key = JSON.stringify([state.buoys.map((b) => b.status), hot, active.map((a) => [a.id, a.status])]);

  useEffect(() => {
    if (!ready) return;
    const y = ym.current, L = layouts.current, g = layer.current;
    g.removeAll();
    const byId = Object.fromEntries(state.buoys.map((b) => [b.id, b]));

    for (const s of state.sectors) {
      const isHot = hot.includes(s.n);
      g.add(new y.Rectangle([[s.south, s.west], [s.north, s.east]], {}, {
        fill: false, strokeColor: isHot ? C.warn : C.primary, strokeOpacity: isHot ? 0.95 : 0.4,
        strokeWidth: isHot ? 2 : 1, strokeStyle: 'dash', interactivityModel: 'default#transparent',
      }));
      g.add(new y.Placemark([s.north, s.west], { n: s.n, hot: isHot ? 'hot' : '' }, {
        iconLayout: L.sector, iconOffset: [6, 4], interactivityModel: 'default#transparent',
      }));
    }
    for (const [a, b] of state.links) {
      if (!byId[a] || !byId[b]) continue;
      g.add(new y.Polyline([[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]], {}, {
        strokeColor: C.primary, strokeOpacity: 0.5, strokeWidth: 1.5, interactivityModel: 'default#transparent',
      }));
    }
    const intercept = active.find((a) => a.status === 'intercept');
    if (intercept) {
      const [ilat, ilon] = state.inspector;
      g.add(new y.Polyline([[ilat, ilon], [intercept.lat, intercept.lon]], {}, {
        strokeColor: C.primary, strokeWidth: 3, strokeStyle: 'dash', interactivityModel: 'default#transparent',
      }));
      if (intercept.distance_km != null) {
        g.add(new y.Placemark([(ilat + intercept.lat) / 2, (ilon + intercept.lon) / 2], { text: km(intercept.distance_km) }, {
          iconLayout: L.label, interactivityModel: 'default#transparent',
        }));
      }
    }
    for (const b of state.buoys) {
      const r = b.status === 'alert' ? 12 : 9;
      g.add(new y.Placemark([b.lat, b.lon], {
        status: b.status, hintContent: `${b.name} · сектор ${b.sector} · батарея ${b.battery} %`,
      }, {
        iconLayout: L.buoy, iconOffset: [-r, -r], iconShape: { type: 'Circle', coordinates: [r, r], radius: r + 4 },
        zIndex: b.status === 'alert' ? 1000 : 500,
      }));
    }
    g.add(new y.Placemark(state.inspector, { hintContent: 'Катер инспектора' }, {
      iconLayout: L.inspector, iconOffset: [-7, -7], iconShape: { type: 'Circle', coordinates: [7, 7], radius: 10 },
    }));
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // подлёт к новой тревоге
  const focus = active.find((a) => a.status === 'new' || a.status === 'intercept');
  useEffect(() => {
    if (ready && focus) map.current.setCenter([focus.lat, focus.lon], 12, { duration: 800 });
  }, [ready, focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="on-photo h-full w-full" />;
}
