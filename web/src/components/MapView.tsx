import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import { AttributionControl, MapContainer, Marker, Pane, Polygon, Polyline, Rectangle, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Buoy, State } from '../types';
import { km } from '../format';
import { BUOY_STATUS, areaOf, esc, gridTicks, isCompact, maskRings, pad, type Bounds, type MapHandle, type Selection } from '../geo';
import { useBooting } from '../motion';
import { useTheme } from '../theme';
import { WARN } from '../design';
import LiveDelta, { loadDelta } from './LiveDelta';

/** Цвета схемы по теме: ночью вода темнее суши, днём — синее, вне района — затемнение или высветление */
const PALETTE = {
  night: { accent: '#7A866F', warn: WARN.night, alert: '#EF4444', primary: '#E2E8F0', mask: '#050B16', maskOpacity: 0.62,
    water: '#0A1628', coast: 'rgba(132,170,205,.32)', reeds: 'rgba(122,134,111,.16)' },
  day: { accent: '#5E6A57', warn: WARN.day, alert: '#C02626', primary: '#0B1628', mask: '#F4F7FA', maskOpacity: 0.6,
    water: '#B4CADC', coast: 'rgba(60,95,130,.4)', reeds: 'rgba(94,106,87,.24)' },
};
type Palette = (typeof PALETTE)['night'];

/** Подложка дельты из OpenStreetMap: море, русла, протоки, плавни. Толщина проток растёт с масштабом. */
const DELTA_STYLE = (kind: string, z: number, C: Palette): L.PathOptions => {
  const k = Math.max(0.6, Math.min(2.2, (z - 8.5) / 2));
  switch (kind) {
    case 'sea': return { stroke: true, color: C.coast, weight: 1, fillColor: C.water, fillOpacity: 1 };
    case 'water': return { stroke: false, fillColor: C.water, fillOpacity: 1 };
    case 'wetland': return { stroke: false, fillColor: C.reeds, fillOpacity: 1 };
    case 'river': return { color: C.water, weight: 1.8 * k, opacity: 1, lineCap: 'round', lineJoin: 'round' };
    default: return { color: C.water, weight: 0.8 * k, opacity: 0.9, lineCap: 'round', lineJoin: 'round' };
  }
};

function DeltaLayer({ c }: { c: Palette }) {
  const map = useMap();
  const pal = useRef(c);
  const ref = useRef<L.GeoJSON | null>(null);
  pal.current = c;
  // смена темы — перекрасить уже загруженную подложку
  useEffect(() => { ref.current?.setStyle((f) => DELTA_STYLE((f as Feature).properties?.kind, map.getZoom(), c)); }, [c, map]);
  useEffect(() => {
    let layer: L.GeoJSON | null = null;
    let alive = true;
    const renderer = L.canvas({ pane: 'land', padding: 0.4 });
    const restyle = () => layer?.setStyle((f) => DELTA_STYLE((f as Feature).properties?.kind, map.getZoom(), pal.current));
    loadDelta().then((fc: FeatureCollection) => {
      if (!alive) return;
      // порядок слоёв: плавни, море, водоёмы, затем линии рек поверх
      const order = ['wetland', 'sea', 'water', 'stream', 'river'];
      fc = { ...fc, features: [...fc.features].sort((a, b) => order.indexOf(a.properties?.kind) - order.indexOf(b.properties?.kind)) };
      layer = L.geoJSON(fc, {
        renderer, interactive: false,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">участники OpenStreetMap</a>',
        style: (f) => DELTA_STYLE((f as Feature).properties?.kind, map.getZoom(), pal.current),
      } as L.GeoJSONOptions).addTo(map);
      ref.current = layer;
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

const buoyIcon = (b: Buoy, i: number) => memo(`b|${b.id}|${b.status}|${b.name}|${i}`, () => {
  const s = b.status === 'alert' ? 24 : 18;
  const fx = b.status === 'alert' ? '<span class="pulse"></span><span class="pulse p2"></span>' : '';
  return L.divIcon({
    className: '',
    html: `<div class="buoy buoy--${b.status}" style="--i:${i};--d:${((i * 0.83) % 3.6).toFixed(2)}s">${fx}<span class="map-label">${esc(b.name)}</span></div>`,
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

/** После добавления на карту: нормированная длина пути — для прорисовки рамки. */
const DRAW = {
  add: (e: L.LeafletEvent) => ((e.target as L.Path).getElement() as SVGPathElement | undefined)?.setAttribute('pathLength', '1'),
};

/** Держит карту в районе дежурства и отдаёт наружу управление ею. */
function Bounded({ area, handle, focus, booting, fitPad }: {
  area: Bounds; handle: MutableRefObject<MapHandle | null>; focus?: { id: string; lat: number; lon: number }; booting: boolean; fitPad?: FitPad;
}) {
  const map = useMap();
  useEffect(() => {
    // в «Карте — всё» часть экрана занята листом и шапкой: границы шире, чтобы район можно было вписать в свободную часть
    const view = L.latLngBounds(pad(area, fitPad ? 3 : 0.12));
    // зазор вокруг района, чтобы была видна его граница; сверху, справа и снизу — под кнопки и легенду
    const fit = { paddingTopLeft: fitPad?.tl ?? [28, 64] as [number, number], paddingBottomRight: fitPad?.br ?? [64, 64] as [number, number] };
    // меньше этого масштаба отдалить нельзя: весь район с небольшим запасом
    const limit = () => {
      map.setMinZoom(0);
      map.setMinZoom(fitPad ? map.getBoundsZoom(area, false, L.point(fitPad.tl[0] + fitPad.br[0], fitPad.tl[1] + fitPad.br[1])) - 0.6 : map.getBoundsZoom(view, false));
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
/** Отступы вписывания района: сверху-слева и снизу-справа, в пикселях */
export type FitPad = { tl: [number, number]; br: [number, number] };

export default function MapView({ state, handle, selected, onSelect, live = false, pad }: {
  state: State; handle: MutableRefObject<MapHandle | null>; live?: boolean; pad?: FitPad;
} & Selection) {
  const booting = useBooting();
  const C = PALETTE[useTheme().theme];
  // Выбор не пересоздаёт значок: на живом элементе переключается класс, и буй плавно
  // увеличивается с кольцом (пересоздание мигало при загрузке и сбрасывало наведение).
  const markers = useRef<Record<string, L.Marker>>({});
  const statuses = state.buoys.map((b) => b.status).join();
  useEffect(() => {
    for (const [id, m] of Object.entries(markers.current)) {
      m.getElement()?.querySelector('.buoy')?.classList.toggle('buoy--selected', id === selected);
    }
  }, [selected, statuses]);

  const area = useMemo(() => areaOf(state.sectors), [state.sectors]);
  const ticks = useMemo(() => gridTicks(state.sectors), [state.sectors]);
  const byId = useMemo(() => Object.fromEntries(state.buoys.map((b) => [b.id, b])), [state.buoys]);
  const active = state.alerts.find((a) => a.status === 'new' || a.status === 'intercept');
  const intercept = state.alerts.find((a) => a.status === 'intercept');
  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];

  return (
    <MapContainer bounds={area} zoomSnap={0.1} zoomDelta={0.5} maxZoom={13} maxBoundsViscosity={1}
      zoomControl={false} attributionControl={false} className="map-scheme h-full w-full">
      <AttributionControl prefix={false} position="bottomright" />
      <Bounded area={area} handle={handle} focus={active} booting={booting} fitPad={pad} />
      {live && <LiveDelta area={area} buoys={state.buoys} alerts={state.alerts} />}
      <ClickAway onSelect={onSelect} />
      {/* суша грузится позже остальных слоёв — своя панель под ними, иначе она перекроет сетку и маску */}
      <Pane name="land" style={{ zIndex: 350 }}><DeltaLayer c={C} /></Pane>

      {/* всё за пределами района — приглушено */}
      <Polygon positions={maskRings(area)} interactive={false} pathOptions={{ stroke: false, fillColor: C.mask, fillOpacity: C.maskOpacity }} />

      {state.sectors.map((s) => (
        <Rectangle key={s.n} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
          pathOptions={{ color: C.primary, opacity: 0.12, weight: 1, fill: false, className: 'fade-in' }} />
      ))}
      {state.sectors.filter((s) => hot.includes(s.n)).map((s) => (
        <Rectangle key={`hot${s.n}`} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
          pathOptions={{ color: C.warn, opacity: 0.9, weight: 1.5, fillColor: C.warn, fillOpacity: 0.05 }} />
      ))}
      <Rectangle bounds={area} interactive={false} eventHandlers={DRAW}
        pathOptions={{ color: C.primary, opacity: 0.4, weight: 1.2, fill: false, className: 'draw' }} />

      {state.links.map(([a, b]) => {
        if (!byId[a] || !byId[b]) return null;
        const alarm = byId[a].status === 'alert' || byId[b].status === 'alert';
        return (
          <Polyline key={`${a}-${b}`} positions={[[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]]} interactive={false}
            pathOptions={{ color: alarm ? C.alert : C.accent, opacity: alarm ? 0.7 : 0.5, weight: 1.2, dashArray: '2 5', className: 'fade-in' }} />
        );
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
        <Marker key={`${b.id}-${b.status}`} position={[b.lat, b.lon]} icon={buoyIcon(b, i)}
          ref={(m) => { if (m) markers.current[b.id] = m; else delete markers.current[b.id]; }}
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
