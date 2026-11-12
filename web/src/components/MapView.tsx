import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import L from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import { AttributionControl, GeoJSON, MapContainer, Marker, Pane, Polygon, Polyline, Rectangle, Tooltip, useMap } from 'react-leaflet';
import type { Buoy, State } from '../types';
import { km } from '../format';
import { BUOY_STATUS, areaOf, esc, isCompact, maskRings, pad, type Bounds, type MapHandle } from '../geo';

const C = { accent: '#7A866F', warn: '#F59E0B', primary: '#E2E8F0', land: '#15253B', coast: '#2B3D55', mask: '#050B16' };

const buoyIcon = (b: Buoy) => {
  const s = b.status === 'alert' ? 24 : 18;
  return L.divIcon({
    className: '',
    html: `<div class="buoy buoy--${b.status}">${b.status === 'alert' ? '<span class="pulse"></span><span class="pulse p2"></span>' : ''}`
      + `<span class="map-label">${esc(b.name)}</span></div>`,
    iconSize: [s, s], iconAnchor: [s / 2, s / 2],
  });
};
const inspectorIcon = L.divIcon({
  className: '', html: '<div class="inspector"><span class="map-label">Вы</span></div>', iconSize: [14, 14], iconAnchor: [7, 7],
});
const sectorIcon = (n: number, hot: boolean) => L.divIcon({
  className: '', html: `<div class="sector-label${hot ? ' hot' : ''}">${n}${hot ? '<span>· высокий риск</span>' : ''}</div>`,
  iconSize: [0, 0], iconAnchor: [-6, -6],
});

/** Держит карту в районе дежурства и отдаёт наружу управление ею. */
function Bounded({ area, handle, focus }: {
  area: Bounds; handle: MutableRefObject<MapHandle | null>; focus?: { id: string; lat: number; lon: number };
}) {
  const map = useMap();
  useEffect(() => {
    const view = L.latLngBounds(pad(area, 0.12));
    // зазор вокруг района, чтобы была видна его граница; сверху, справа и снизу — под кнопки и легенду
    const fitArea = (animate: boolean) => map.fitBounds(area, { paddingTopLeft: [28, 64], paddingBottomRight: [64, 64], animate });
    // меньше этого масштаба отдалить нельзя: весь район с небольшим запасом
    const limit = () => {
      map.setMinZoom(0);
      map.setMinZoom(map.getBoundsZoom(view, false));
    };
    const labels = () => map.getContainer().classList.toggle('compact', isCompact(map.getSize().x, map.getZoom()));
    map.setMaxBounds(view);
    limit();
    fitArea(false);
    labels();
    map.on('resize', limit);
    map.on('zoomend resize', labels);
    handle.current = {
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      fitArea: () => fitArea(true),
      flyTo: (lat, lon, zoom = 11.5) => map.flyTo([lat, lon], zoom, { duration: 0.8 }),
    };
    return () => {
      map.off('resize', limit);
      map.off('zoomend resize', labels);
      handle.current = null;
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], 11.5, { duration: 1.1 });
  }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Офлайн-схема дельты (Natural Earth) — работает без интернета и без ключа. */
export default function MapView({ state, handle }: { state: State; handle: MutableRefObject<MapHandle | null> }) {
  const [delta, setDelta] = useState<GeoJsonObject | null>(null);
  useEffect(() => {
    fetch('/geo/volga-delta.geojson').then((r) => r.json()).then(setDelta).catch(() => setDelta(null));
  }, []);

  const area = useMemo(() => areaOf(state.sectors), [state.sectors]);
  const byId = useMemo(() => Object.fromEntries(state.buoys.map((b) => [b.id, b])), [state.buoys]);
  const active = state.alerts.find((a) => a.status === 'new' || a.status === 'intercept');
  const intercept = state.alerts.find((a) => a.status === 'intercept');
  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];

  return (
    <MapContainer bounds={area} zoomSnap={0.1} zoomDelta={0.5} maxZoom={13} maxBoundsViscosity={1}
      zoomControl={false} attributionControl={false} className="map-scheme h-full w-full">
      <AttributionControl prefix={false} position="bottomright" />
      <Bounded area={area} handle={handle} focus={active} />
      {/* суша грузится позже остальных слоёв — своя панель под ними, иначе она перекроет сетку и маску */}
      <Pane name="land" style={{ zIndex: 350 }}>
        {delta && (
          <GeoJSON data={delta} interactive={false} attribution='<a href="https://www.naturalearthdata.com">Natural Earth</a>'
            style={{ color: C.coast, weight: 1, fillColor: C.land, fillOpacity: 1 }} />
        )}
      </Pane>

      {/* всё за пределами района — приглушено */}
      <Polygon positions={maskRings(area)} interactive={false} pathOptions={{ stroke: false, fillColor: C.mask, fillOpacity: 0.62 }} />

      {state.sectors.map((s) => (
        <Rectangle key={s.n} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
          pathOptions={{ color: C.primary, opacity: 0.12, weight: 1, fill: false }} />
      ))}
      {state.sectors.filter((s) => hot.includes(s.n)).map((s) => (
        <Rectangle key={`hot${s.n}`} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
          pathOptions={{ color: C.warn, opacity: 0.9, weight: 1.5, fillColor: C.warn, fillOpacity: 0.035 }} />
      ))}
      <Rectangle bounds={area} interactive={false} pathOptions={{ color: C.primary, opacity: 0.55, weight: 1.5, fill: false }} />

      {state.links.map(([a, b]) => byId[a] && byId[b] && (
        <Polyline key={`${a}-${b}`} positions={[[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]]} interactive={false}
          pathOptions={{ color: C.accent, opacity: 0.55, weight: 1.2, dashArray: '2 5' }} />
      ))}

      {intercept && (
        <Polyline positions={[state.inspector, [intercept.lat, intercept.lon]]} interactive={false}
          pathOptions={{ color: C.primary, weight: 2.5, dashArray: '8 6' }}>
          {intercept.distance_km != null && (
            <Tooltip permanent direction="center" className="tip">{km(intercept.distance_km)}</Tooltip>
          )}
        </Polyline>
      )}

      {state.sectors.map((s) => (
        <Marker key={`l${s.n}-${hot.includes(s.n)}`} position={[s.north, s.west]} icon={sectorIcon(s.n, hot.includes(s.n))} interactive={false} />
      ))}
      {state.buoys.map((b) => (
        <Marker key={`${b.id}-${b.status}`} position={[b.lat, b.lon]} icon={buoyIcon(b)} zIndexOffset={b.status === 'alert' ? 1000 : 0}>
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
