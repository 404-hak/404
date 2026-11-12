import type { Sector } from './types';

/** [[юг, запад], [север, восток]] */
export type Bounds = [[number, number], [number, number]];

/** Район дежурства — объединение всех секторов. */
export function areaOf(sectors: Sector[]): Bounds {
  return [
    [Math.min(...sectors.map((s) => s.south)), Math.min(...sectors.map((s) => s.west))],
    [Math.max(...sectors.map((s) => s.north)), Math.max(...sectors.map((s) => s.east))],
  ];
}

/** Расширить границы на долю их размера с каждой стороны (как L.LatLngBounds.pad). */
export function pad([[s, w], [n, e]]: Bounds, k: number): Bounds {
  const dl = (n - s) * k, dw = (e - w) * k;
  return [[s - dl, w - dw], [n + dl, e + dw]];
}

export function ring([[s, w], [n, e]]: Bounds): [number, number][] {
  return [[s, w], [n, w], [n, e], [s, e], [s, w]];
}

/** Маска «всё, кроме района»: внешнее кольцо с запасом и дыра по границе района. */
export function maskRings(area: Bounds): [number, number][][] {
  return [ring(pad(area, 6)), ring(area)];
}

export const sectorCenter = (s: Sector): [number, number] => [(s.south + s.north) / 2, (s.west + s.east) / 2];

/** Уголки рамки района, как в видоискателе: четыре «Г» равной длины на экране. */
export function brackets([[s, w], [n, e]]: Bounds): [number, number][][] {
  const dLon = (e - w) * 0.045;
  const dLat = dLon * Math.cos(((s + n) / 2) * Math.PI / 180); // в Меркаторе градус широты длиннее
  return [
    [[n - dLat, w], [n, w], [n, w + dLon]],
    [[n, e - dLon], [n, e], [n - dLat, e]],
    [[s + dLat, e], [s, e], [s, e - dLon]],
    [[s, w + dLon], [s, w], [s + dLat, w]],
  ];
}

const dm = (x: number) => {
  const d = Math.floor(x + 1e-9), m = Math.round((x - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}′`;
};

/** Подписи линий сетки: долготы — над верхним краем, широты — у левого края над линией. */
export function gridTicks(sectors: Sector[]) {
  const uniq = (xs: number[]) => [...new Set(xs.map((x) => x.toFixed(4)))].map(Number).sort((a, b) => a - b);
  const lons = uniq(sectors.flatMap((s) => [s.west, s.east]));
  const lats = uniq(sectors.flatMap((s) => [s.south, s.north]));
  const north = Math.max(...lats), west = Math.min(...lons);
  return [
    ...lons.map((lon) => ({ kind: 'lon' as const, at: [north, lon] as [number, number], text: `${dm(lon)}E` })),
    ...lats.filter((lat) => lat < north).map((lat) => ({ kind: 'lat' as const, at: [lat, west] as [number, number], text: `${dm(lat)}N` })),
  ];
}

/** Выбранный буй: подсвечен на карте, его карточка — в панели. */
export interface Selection { selected: string | null; onSelect: (id: string | null) => void }

/** Управление картой — одинаковое для спутника и схемы. */
export interface MapHandle {
  zoomIn(): void;
  zoomOut(): void;
  fitArea(): void;
  flyTo(lat: number, lon: number, zoom?: number): void;
}

/** Узкий экран и общий план: подписи буёв скрыты, иначе они налезают друг на друга. */
export const isCompact = (widthPx: number, zoom: number) => widthPx < 640 && zoom < 11;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const BUOY_STATUS: Record<string, string> = {
  ok: 'норма', warn: 'внимание', alert: 'тревога', offline: 'нет связи',
};
