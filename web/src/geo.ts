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
