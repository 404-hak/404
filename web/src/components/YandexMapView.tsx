/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { State } from '../types';
import { km } from '../format';
import { loadYmaps } from '../yandex';
import { BUOY_STATUS, areaOf, gridTicks, isCompact, maskRings, pad, type Bounds, type MapHandle, type Selection } from '../geo';
import { useBooting } from '../motion';

const C = { accent: '#7A866F', warn: '#F59E0B', alert: '#EF4444', primary: '#E2E8F0', mask: '#0B1628' };
// зазор вокруг района [сверху, справа, снизу, слева]: видна граница, кнопки и легенда её не закрывают
const ZOOM_MARGIN = [64, 64, 64, 28];

interface Props extends Selection { state: State; handle: MutableRefObject<MapHandle | null>; onFail: (why: string) => void }

/**
 * Яндекс Карты, «Гибрид»: спутниковый снимок дельты с подписями.
 * Карта не уходит за район дежурства: панорама ограничена, снаружи — затемнение.
 * Поверх — слой 404: сектора, связи буёв, буи, катер инспектора и маршрут перехвата.
 */
export default function YandexMapView({ state, handle, onFail, selected, onSelect }: Props) {
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const el = useRef<HTMLDivElement>(null);
  const ym = useRef<any>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const layouts = useRef<Record<string, any>>({});
  const marks = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);
  const booting = useBooting();
  const area = useMemo(() => areaOf(state.sectors), [state.sectors]);

  useEffect(() => {
    el.current?.classList.toggle('booting', booting);
  }, [booting]);

  // создание карты
  useEffect(() => {
    let alive = true;
    loadYmaps()
      .then((y) => {
        if (!alive || !el.current) return;
        ym.current = y;
        const [[s, w], [n, e]] = area;
        const m = new y.Map(el.current, { center: [(s + n) / 2, (w + e) / 2], zoom: 10, type: 'yandex#hybrid', controls: [] }, {
          suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true, autoFitToViewport: 'always', maxZoom: 16,
        });
        const fitArea = (duration = 0) => m.setBounds(area, { checkZoomRange: true, zoomMargin: ZOOM_MARGIN, duration });
        // Границы карты: меньше этого масштаба не отдалить (весь район с небольшим запасом),
        // а панорама не выходит за то, что видно на этом масштабе. Пересчёт при смене размера окна.
        const limit = () => {
          const size = m.container.getSize();
          const proj = m.options.get('projection');
          const { center, zoom } = y.util.bounds.getCenterAndZoom(pad(area, 0.15), size, proj);
          const [cx, cy] = proj.toGlobalPixels(center, zoom);
          const sw = proj.fromGlobalPixels([cx - size[0] / 2, cy + size[1] / 2], zoom);
          const ne = proj.fromGlobalPixels([cx + size[0] / 2, cy - size[1] / 2], zoom);
          m.options.set({ minZoom: Math.max(1, zoom), restrictMapArea: pad([sw, ne] as Bounds, 0.01) });
        };
        const labels = () => el.current?.classList.toggle('compact', isCompact(m.container.getSize()[0], m.getZoom()));
        limit();
        fitArea();
        labels();
        m.container.events.add('sizechange', limit);
        m.events.add('click', () => pick.current(null));
        m.events.add('boundschange', labels);

        layouts.current = {
          buoy: y.templateLayoutFactory.createClass(
            '<div class="buoy buoy--{{ properties.status }}{% if properties.selected %} buoy--selected{% endif %}" style="--i:{{ properties.i }};--d:{{ properties.d }}s">'
            + '{% if properties.status == "alert" %}<span class="pulse"></span><span class="pulse p2"></span>{% endif %}'
            + '<span class="map-label">{{ properties.name }}</span></div>'),
          inspector: y.templateLayoutFactory.createClass('<div class="inspector"><span class="map-label">Вы</span></div>'),
          sector: y.templateLayoutFactory.createClass(
            '<div class="sector-label {{ properties.hot }}">{{ properties.n }}{% if properties.hot %}<span>· риск</span>{% endif %}</div>'),
          label: y.templateLayoutFactory.createClass('<div class="route-label">{{ properties.text }}</div>'),
          lat: y.templateLayoutFactory.createClass('<span class="tick tick--lat">{{ properties.text }}</span>'),
          lon: y.templateLayoutFactory.createClass('<span class="tick tick--lon">{{ properties.text }}</span>'),
        };

        // всё за пределами района — затемнено, сам район обведён
        m.geoObjects.add(new y.Polygon(maskRings(area), {}, {
          fillColor: C.mask, fillOpacity: 0.72, strokeWidth: 0, fillRule: 'evenOdd', interactivityModel: 'default#transparent',
        }));
        m.geoObjects.add(new y.Rectangle(area, {}, {
          fill: false, strokeColor: C.primary, strokeOpacity: 0.55, strokeWidth: 1.5, interactivityModel: 'default#transparent',
        }));
        // координаты линий сетки по краю района
        for (const t of gridTicks(state.sectors)) {
          m.geoObjects.add(new y.Placemark(t.at, { text: t.text }, {
            iconLayout: layouts.current[t.kind], interactivityModel: 'default#transparent', zIndex: 50,
          }));
        }
        layer.current = new y.GeoObjectCollection();
        m.geoObjects.add(layer.current);
        map.current = m;
        handle.current = {
          zoomIn: () => m.setZoom(m.getZoom() + 1, { checkZoomRange: true, duration: 200 }),
          zoomOut: () => m.setZoom(Math.max(m.options.get('minZoom'), m.getZoom() - 1), { checkZoomRange: true, duration: 200 }),
          fitArea: () => fitArea(400),
          flyTo: (lat, lon, zoom = 12) => m.setCenter([lat, lon], zoom, { checkZoomRange: true, duration: 600 }),
        };
        setReady(true);
      })
      .catch((e) => alive && onFail(String(e?.message ?? e)));
    return () => {
      alive = false;
      handle.current = null;
      map.current?.destroy();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Слой 404 перерисовывается только при смене статусов, горячих секторов или активных алертов:
  // полная перерисовка перезапускает анимации буёв. Заряд батареи в подсказке обновляется отдельно.
  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];
  const active = state.alerts.filter((a) => a.status !== 'resolved');
  const key = JSON.stringify([state.buoys.map((b) => b.status), hot, active.map((a) => [a.id, a.status])]);
  const hint = (b: State['buoys'][number]) => `${b.name} · ${BUOY_STATUS[b.status]} · сектор ${b.sector} · батарея ${b.battery} %`;

  useEffect(() => {
    if (!ready) return;
    const y = ym.current, L = layouts.current, g = layer.current;
    g.removeAll();
    const byId = Object.fromEntries(state.buoys.map((b) => [b.id, b]));
    const flat = { interactivityModel: 'default#transparent' };

    for (const s of state.sectors) {
      const isHot = hot.includes(s.n);
      g.add(new y.Rectangle([[s.south, s.west], [s.north, s.east]], {}, isHot
        ? { ...flat, fillColor: C.warn, fillOpacity: 0.14, strokeColor: C.warn, strokeOpacity: 0.95, strokeWidth: 2 }
        : { ...flat, fill: false, strokeColor: C.primary, strokeOpacity: 0.3, strokeWidth: 1 }));
      g.add(new y.Placemark([s.north, s.west], { n: s.n, hot: isHot ? 'hot' : '' }, {
        ...flat, iconLayout: L.sector, iconOffset: [6, 6], zIndex: 100,
      }));
    }
    for (const [a, b] of state.links) {
      if (!byId[a] || !byId[b]) continue;
      const alarm = byId[a].status === 'alert' || byId[b].status === 'alert';
      g.add(new y.Polyline([[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]], {}, {
        ...flat, strokeColor: alarm ? C.alert : '#A9B79C', strokeOpacity: alarm ? 0.9 : 0.75, strokeWidth: alarm ? 2 : 1.5, strokeStyle: 'dot',
      }));
    }
    const intercept = active.find((a) => a.status === 'intercept');
    if (intercept) {
      const [ilat, ilon] = state.inspector;
      g.add(new y.Polyline([[ilat, ilon], [intercept.lat, intercept.lon]], {}, {
        ...flat, strokeColor: C.primary, strokeWidth: 3, strokeStyle: 'dash',
      }));
      if (intercept.distance_km != null) {
        g.add(new y.Placemark([(ilat + intercept.lat) / 2, (ilon + intercept.lon) / 2], { text: km(intercept.distance_km) }, {
          ...flat, iconLayout: L.label,
        }));
      }
    }
    marks.current = {};
    state.buoys.forEach((b, i) => {
      const r = b.status === 'alert' ? 12 : 9;
      const pm = new y.Placemark([b.lat, b.lon], {
        status: b.status, name: b.name, i, d: ((i * 0.83) % 3.6).toFixed(2), hintContent: hint(b), selected: b.id === selected,
      }, {
        iconLayout: L.buoy, iconOffset: [-r, -r], iconShape: { type: 'Circle', coordinates: [r, r], radius: r + 4 },
        zIndex: b.status === 'alert' ? 1000 : 500,
      });
      pm.events.add('click', () => pick.current(b.id));
      marks.current[b.id] = pm;
      g.add(pm);
    });
    g.add(new y.Placemark(state.inspector, { hintContent: 'Вы — катер инспектора' }, {
      iconLayout: L.inspector, iconOffset: [-7, -7], iconShape: { type: 'Circle', coordinates: [7, 7], radius: 10 }, zIndex: 900,
    }));
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // выделение меняет только сам значок, без перерисовки слоя
  useEffect(() => {
    if (!ready) return;
    for (const [id, pm] of Object.entries(marks.current)) {
      pm.properties.set('selected', id === selected);
      pm.options.set('zIndex', id === selected ? 1200 : pm.properties.get('status') === 'alert' ? 1000 : 500);
    }
  }, [ready, selected, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // подсказки с зарядом батареи — без перерисовки слоя
  useEffect(() => {
    if (!ready) return;
    for (const b of state.buoys) marks.current[b.id]?.properties.set('hintContent', hint(b));
  }, [ready, state]); // eslint-disable-line react-hooks/exhaustive-deps

  // к новой тревоге — подлёт, после её закрытия — обратно ко всему району
  const focus = active.find((a) => a.status === 'new' || a.status === 'intercept');
  const seen = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (focus) handle.current?.flyTo(focus.lat, focus.lon, 12);
    else if (seen.current) handle.current?.fitArea();
    seen.current = Boolean(focus);
  }, [ready, focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="map-photo h-full w-full" />;
}
