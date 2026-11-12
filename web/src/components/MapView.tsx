import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import { AttributionControl, GeoJSON, MapContainer, Marker, Polyline, Rectangle, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Alert, State } from '../types';
import { km } from '../format';

const C = { accent: '#7A866F', warn: '#F59E0B', alert: '#EF4444', primary: '#E2E8F0', surface: '#142236', bg: '#0B1628', grey: '#64748B' };

const buoyIcon = (status: string) =>
  L.divIcon({
    className: '',
    html: `<div class="buoy buoy--${status}">${status === 'alert' ? '<span class="pulse"></span><span class="pulse p2"></span>' : ''}</div>`,
    iconSize: status === 'alert' ? [24, 24] : [18, 18],
    iconAnchor: status === 'alert' ? [12, 12] : [9, 9],
  });
const inspectorIcon = L.divIcon({ className: '', html: '<div class="inspector"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
const sectorLabel = (n: number, hot: boolean) =>
  L.divIcon({ className: '', html: `<div class="sector-label${hot ? ' hot' : ''}">${n}</div>`, iconSize: [16, 14], iconAnchor: [-6, -4] });

function FlyToAlert({ alert }: { alert: Alert | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (alert) map.flyTo([alert.lat, alert.lon], 11, { duration: 1.2 });
  }, [alert?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function MapView({ state, basemap }: { state: State; basemap: 'scheme' | 'tiles' }) {
  const [delta, setDelta] = useState<GeoJsonObject | null>(null);
  useEffect(() => {
    fetch('/geo/volga-delta.geojson').then((r) => r.json()).then(setDelta).catch(() => setDelta(null));
  }, []);

  const byId = useMemo(() => Object.fromEntries(state.buoys.map((b) => [b.id, b])), [state.buoys]);
  const active = state.alerts.find((a) => a.status === 'new' || a.status === 'intercept');
  const intercept = state.alerts.find((a) => a.status === 'intercept');
  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];

  return (
    <MapContainer center={state.center} zoom={10} minZoom={8} maxZoom={14} zoomControl attributionControl={false}
      className="h-full w-full" preferCanvas={false}>
      <AttributionControl prefix='<a href="https://leafletjs.com">Leaflet</a>' />
      {basemap === 'tiles' && (
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" subdomains="abcd" opacity={0.85}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' />
      )}
      {basemap === 'scheme' && delta && (
        <GeoJSON data={delta} attribution='<a href="https://www.naturalearthdata.com">Natural Earth</a>'
          style={{ color: '#1E3050', weight: 1, fillColor: C.surface, fillOpacity: 1 }} />
      )}

      {state.sectors.map((s) => {
        const isHot = hot.includes(s.n);
        return (
          <Rectangle key={s.n} bounds={[[s.south, s.west], [s.north, s.east]]} interactive={false}
            pathOptions={{ color: isHot ? C.warn : C.grey, opacity: isHot ? 0.9 : 0.35, weight: isHot ? 1.5 : 1, dashArray: '4 4', fill: false }} />
        );
      })}
      {state.sectors.map((s) => (
        <Marker key={`l${s.n}`} position={[s.north, s.west]} icon={sectorLabel(s.n, hot.includes(s.n))} interactive={false} />
      ))}

      {state.links.map(([a, b]) => byId[a] && byId[b] && (
        <Polyline key={`${a}-${b}`} positions={[[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]]} interactive={false}
          pathOptions={{ color: C.accent, opacity: 0.45, weight: 1.2 }} />
      ))}

      {intercept && (
        <Polyline positions={[state.inspector, [intercept.lat, intercept.lon]]} interactive={false}
          pathOptions={{ color: C.primary, weight: 2, dashArray: '7 6' }}>
          <Tooltip permanent direction="center" className="tip">{intercept.distance_km != null ? km(intercept.distance_km) : ''}</Tooltip>
        </Polyline>
      )}

      {state.buoys.map((b) => (
        <Marker key={b.id} position={[b.lat, b.lon]} icon={buoyIcon(b.status)} zIndexOffset={b.status === 'alert' ? 1000 : 0}>
          <Tooltip className="tip" direction="top" offset={[0, -10]}>
            {b.name} · сектор {b.sector} · батарея {b.battery} %
          </Tooltip>
        </Marker>
      ))}
      <Marker position={state.inspector} icon={inspectorIcon}>
        <Tooltip className="tip" direction="top" offset={[0, -8]}>Катер инспектора</Tooltip>
      </Marker>
      <FlyToAlert alert={active} />
    </MapContainer>
  );
}
