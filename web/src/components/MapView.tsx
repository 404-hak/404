import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import { AttributionControl, MapContainer, Marker, Pane, Polygon, Polyline, Rectangle, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Buoy, State } from '../types';
import { km } from '../format';
import { BUOY_STATUS, areaOf, brackets, esc, gridTicks, isCompact, maskRings, pad, type Bounds, type MapHandle, type Selection } from '../geo';
import { useBooting } from '../motion';

const C = { accent: '#7A866F', warn: '#F59E0B', alert: '#EF4444', primary: '#E2E8F0', mask: '#050B16', signal: '#D3DEC6',
  water: '#0A1628', coast: 'rgba(132,170,205,.32)', reeds: 'rgba(122,134,111,.16)' };

/** Подложка дельты из OpenStreetMap: море, русла, протоки, плавни. Толщина проток растёт с масштабом. */
const DELTA_STYLE = (kind: string, z: number): L.PathOptions => {
  const k = Math.max(0.6, Math.min(2.2, (z - 8.5) / 2));
  switch (kind) {
    case 'sea': return { stroke: true, color: C.coast, weight: 1, fillColor: C.water, fillOpacity: 1 };
    case 'water': return { stroke: false, fillColor: C.water, fillOpacity: 1 };
    case 'wetland': return { stroke: false, fillColor: C.reeds, fillOpacity: 1 };
    case 'river': return { color: C.water, weight: 1.8 * k, opacity: 1, lineCap: 'round', lineJoin: 'round' };
    default: return { color: C.water, weight: 0.8 * k, opacity: 0.9, lineCap: 'round', lineJoin: 'round' };
  }
};

function DeltaLayer() {
  const map = useMap();
  useEffect(() => {
    let layer: L.GeoJSON | null = null;
    let alive = true;
    const renderer = L.canvas({ pane: 'land', padding: 0.4 });
    const restyle = () => layer?.setStyle((f) => DELTA_STYLE((f as Feature).properties?.kind, map.getZoom()));
    fetch('/geo/delta-osm.geojson').then((r) => r.json()).then((fc: FeatureCollection) => {
      if (!alive) return;
      // порядок слоёв: плавни, море, водоёмы, затем линии рек поверх
      const order = ['wetland', 'sea', 'water', 'stream', 'river'];
      fc.features.sort((a, b) => order.indexOf(a.properties?.kind) - order.indexOf(b.properties?.kind));
      layer = L.geoJSON(fc, {
        renderer, interactive: false,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">участники OpenStreetMap</a>',
        style: (f) => DELTA_STYLE((f as Feature).properties?.kind, map.getZoom()),
      } as L.GeoJSONOptions).addTo(map);
      layer.getPane('land')?.classList.add('fade-in');
    }).catch(() => { /* без подложки карта всё равно работает */ });
    map.on('zoomend', restyle);
    return () => { alive = false; map.off('zoomend', restyle); layer?.remove(); };
  }, [map]);
  return null;
}

// Иконки кэшируются: новая иконка на каждом такте сервера перезапускала бы анимации буёв
const icons = new Map<string, L.DivIcon>();
const memo = (key: string, make: () => L.DivIcon) => {
  if (!icons.has(key)) icons.set(key, make());
  return icons.get(key)!;
};

const buoyIcon = (b: Buoy, i: number, sel: boolean) => memo(`b|${b.id}|${b.status}|${b.name}|${i}|${sel}`, () => {
  const s = b.status === 'alert' ? 24 : 18;
  const fx = b.status === 'alert' ? '<span class="pulse"></span><span class="pulse p2"></span>' : '<span class="sonar"></span>';
  return L.divIcon({
    className: '',
    html: `<div class="buoy buoy--${b.status}${sel ? ' buoy--selected' : ''}" style="--i:${i};--d:${((i * 0.83) % 3.6).toFixed(2)}s">${fx}<span class="map-label">${esc(b.name)}</span></div>`,
    iconSize: [s, s], iconAnchor: [s / 2, s / 2],
  });
});
const inspectorIcon = L.divIcon({
  className: '', html: '<div class="inspector"><span class="map-label">Вы</span></div>', iconSize: [14, 14], iconAnchor: [7, 7],
});
const sectorIcon = (n: number, hot: boolean) => memo(`s|${n}|${hot}`, () => L.divIcon({
  className: '', html: `<div class="sector-label${hot ? ' hot' : ''}">${n}${hot ? '<span>· риск</span>' : ''}</div>`,
  iconSize: [0, 0], iconAnchor: [-6, -6],
}));
const tickIcon = (text: string, kind: 'lat' | 'lon') => memo(`t|${kind}|${text}`, () => L.divIcon({
  className: '', html: `<span class="tick tick--${kind}">${text}</span>`, iconSize: [0, 0], iconAnchor: [0, 0],
}));

/** После добавления на карту: нормированная длина пути (для анимаций обводки) и задержка. */
const svgPath = (length: number, delay?: number) => ({
  add: (e: L.LeafletEvent) => {
    const el = (e.target as L.Path).getElement() as SVGPathElement | undefined;
    el?.setAttribute('pathLength', String(length));
    if (delay != null) el?.style.setProperty('--d', `${delay.toFixed(2)}s`);
  },
});
const DRAW = svgPath(1);

/** Держит карту в районе дежурства и отдаёт наружу управление ею. */
function Bounded({ area, handle, focus, booting }: {
  area: Bounds; handle: MutableRefObject<MapHandle | null>; focus?: { id: string; lat: number; lon: number }; booting: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    const view = L.latLngBounds(pad(area, 0.12));
    // зазор вокруг района, чтобы была видна его граница; сверху, справа и снизу — под кнопки и легенду
    const fit = { paddingTopLeft: [28, 64] as [number, number], paddingBottomRight: [64, 64] as [number, number] };
    // меньше этого масштаба отдалить нельзя: весь район с небольшим запасом
    const limit = () => {
      map.setMinZoom(0);
      map.setMinZoom(map.getBoundsZoom(view, false));
    };
    const labels = () => map.getContainer().classList.toggle('compact', isCompact(map.getSize().x, map.getZoom()));
    // Центр полёта сразу поджимается внутрь границ: иначе после полёта к бую у края
    // ограничение панорамы дёргает карту назад.
    const inside = (lat: number, lon: number, zoom: number) => {
      const size = map.getSize(), half = size.divideBy(2);
      const nw = map.project(view.getNorthWest(), zoom), se = map.project(view.getSouthEast(), zoom);
      const p = map.project([lat, lon], zoom);
      const x = se.x - nw.x <= size.x ? (nw.x + se.x) / 2 : Math.min(Math.max(p.x, nw.x + half.x), se.x - half.x);
      const y = se.y - nw.y <= size.y ? (nw.y + se.y) / 2 : Math.min(Math.max(p.y, nw.y + half.y), se.y - half.y);
      return map.unproject([x, y], zoom);
    };
    map.setMaxBounds(view);
    limit();
    map.fitBounds(area, { ...fit, animate: false });
    labels();
    map.on('resize', limit);
    map.on('zoomend resize', labels);
    handle.current = {
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      fitArea: () => map.flyToBounds(area, { ...fit, duration: 0.7 }),
      flyTo: (lat, lon, zoom = 11.5) => map.flyTo(inside(lat, lon, zoom), zoom, { duration: 0.9, easeLinearity: 0.2 }),
    };
    return () => {
      map.off('resize', limit);
      map.off('zoomend resize', labels);
      handle.current = null;
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    map.getContainer().classList.toggle('booting', booting);
  }, [map, booting]);

  // к новой тревоге — подлёт, после её закрытия — обратно ко всему району
  const seen = useRef(false);
  useEffect(() => {
    if (focus) handle.current?.flyTo(focus.lat, focus.lon, 11.5);
    else if (seen.current) handle.current?.fitArea();
    seen.current = Boolean(focus);
  }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Клик по пустой карте снимает выделение. */
function ClickAway({ onSelect }: { onSelect: Selection['onSelect'] }) {
  useMapEvents({ click: () => onSelect(null) });
  return null;
}

/** Офлайн-схема дельты по OpenStreetMap — работает без интернета и без ключа. */
export default function MapView({ state, handle, selected, onSelect }: { state: State; handle: MutableRefObject<MapHandle | null> } & Selection) {
  const booting = useBooting();

  const area = useMemo(() => areaOf(state.sectors), [state.sectors]);
  const corners = useMemo(() => brackets(area), [area]);
  const ticks = useMemo(() => gridTicks(state.sectors), [state.sectors]);
  const byId = useMemo(() => Object.fromEntries(state.buoys.map((b) => [b.id, b])), [state.buoys]);
  const active = state.alerts.find((a) => a.status === 'new' || a.status === 'intercept');
  const intercept = state.alerts.find((a) => a.status === 'intercept');
  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];

  return (
    <MapContainer bounds={area} zoomSnap={0.1} zoomDelta={0.5} maxZoom={13} maxBoundsViscosity={1}
      zoomControl={false} attributionControl={false} className="map-scheme h-full w-full">
      <AttributionControl prefix={false} position="bottomright" />
      <Bounded area={area} handle={handle} focus={active} booting={booting} />
      <ClickAway onSelect={onSelect} />
      {/* суша грузится позже остальных слоёв — своя панель под ними, иначе она перекроет сетку и маску */}
      <Pane name="land" style={{ zIndex: 350 }}><DeltaLayer /></Pane>

      {/* всё за пределами района — приглушено */}
      <Polygon positions={maskRings(area)} interactive={false} pathOptions={{ stroke: false, fillColor: C.mask, fillOpacity: 0.62 }} />

      {state.sectors.map((s) => (
        <Rectangle key={s.n} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
          pathOptions={{ color: C.primary, opacity: 0.12, weight: 1, fill: false, className: 'fade-in' }} />
      ))}
      {state.sectors.filter((s) => hot.includes(s.n)).map((s) => (
        <Rectangle key={`hot${s.n}`} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
          pathOptions={{ color: C.warn, opacity: 0.9, weight: 1.5, fillColor: C.warn, fillOpacity: 0.06, className: 'sector-hot' }} />
      ))}
      <Rectangle bounds={area} interactive={false} eventHandlers={DRAW}
        pathOptions={{ color: C.primary, opacity: 0.4, weight: 1.2, fill: false, className: 'draw' }} />
      {corners.map((c, i) => (
        <Polyline key={`c${i}`} positions={c} interactive={false} eventHandlers={DRAW}
          pathOptions={{ color: C.primary, opacity: 0.95, weight: 2.5, lineCap: 'square', className: 'draw late' }} />
      ))}

      {state.links.map(([a, b], i) => {
        if (!byId[a] || !byId[b]) return null;
        const line: [number, number][] = [[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]];
        const alarm = byId[a].status === 'alert' || byId[b].status === 'alert';
        // сигнал бежит от буя с тревогой к соседям
        const path = byId[b].status === 'alert' ? [line[1], line[0]] : line;
        return [
          <Polyline key={`${a}-${b}`} positions={line} interactive={false}
            pathOptions={{ color: alarm ? C.alert : C.accent, opacity: alarm ? 0.6 : 0.5, weight: 1.2, dashArray: '2 5', className: 'fade-in' }} />,
          <Polyline key={`${a}-${b}-p-${alarm}`} positions={path} interactive={false}
            eventHandlers={svgPath(100, alarm ? (i % 3) * 0.4 : (i * 0.61) % 3.4)}
            pathOptions={{ color: alarm ? C.alert : C.signal, opacity: 0.95, weight: 2.5, lineCap: 'round', className: `packet${alarm ? ' packet--alert' : ''}` }} />,
        ];
      })}

      {intercept && (
        <Polyline positions={[state.inspector, [intercept.lat, intercept.lon]]} interactive={false}
          pathOptions={{ color: C.primary, weight: 2.5, className: 'route' }}>
          {intercept.distance_km != null && (
            <Tooltip permanent direction="center" className="tip">{km(intercept.distance_km)}</Tooltip>
          )}
        </Polyline>
      )}

      {ticks.map((t) => (
        <Marker key={`t${t.kind}${t.text}`} position={t.at} icon={tickIcon(t.text, t.kind)} interactive={false} />
      ))}
      {state.sectors.map((s) => (
        <Marker key={`l${s.n}-${hot.includes(s.n)}`} position={[s.north, s.west]} icon={sectorIcon(s.n, hot.includes(s.n))} interactive={false} />
      ))}
      {state.buoys.map((b, i) => (
        <Marker key={`${b.id}-${b.status}`} position={[b.lat, b.lon]} icon={buoyIcon(b, i, b.id === selected)}
          zIndexOffset={b.id === selected ? 1200 : b.status === 'alert' ? 1000 : 0} eventHandlers={{ click: () => onSelect(b.id) }}>
          <Tooltip className="tip" direction="top" offset={[0, -12]}>
            {b.name} · {BUOY_STATUS[b.status]} · сектор {b.sector} · батарея {b.battery} %
          </Tooltip>
        </Marker>
      ))}
      <Marker position={state.inspector} icon={inspectorIcon} zIndexOffset={900}>
        <Tooltip className="tip" direction="top" offset={[0, -10]}>Вы — катер инспектора</Tooltip>
      </Marker>
    </MapContainer>
  );
}
