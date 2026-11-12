import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { Feature, FeatureCollection, MultiLineString, LineString } from 'geojson';
import type { Alert, Buoy } from '../types';
import type { Bounds } from '../geo';
import { introCovering } from '../introBus';
import { currentTheme } from '../theme';
import { reducedMotion } from '../motion';

/** Подложка дельты грузится один раз на страницу: её же рисует схема (MapView) */
let cache: Promise<FeatureCollection> | null = null;
export const loadDelta = () => (cache ??= fetch('/geo/delta-osm.geojson').then((r) => r.json()));

type Line = { pts: L.LatLng[]; river: boolean };

/** Русла и протоки из OpenStreetMap, только те, что заходят в район дежурства (с запасом) */
function linesIn(fc: FeatureCollection, area: Bounds): Line[] {
  const [[s, w], [n, e]] = area;
  const ps = (n - s) * 0.25, pw = (e - w) * 0.25;
  const out: Line[] = [];
  for (const f of fc.features as Feature[]) {
    const kind = f.properties?.kind;
    if (kind !== 'river' && kind !== 'stream') continue;
    const g = f.geometry as MultiLineString | LineString;
    const parts = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    for (const part of parts) {
      let inside = false;
      for (const [lon, lat] of part) if (lat > s - ps && lat < n + ps && lon > w - pw && lon < e + pw) { inside = true; break; }
      if (inside && part.length > 1) out.push({ pts: part.map(([lon, lat]) => L.latLng(lat, lon)), river: kind === 'river' });
    }
  }
  return out;
}

/**
 * Живая дельта: буи «слушают» — от каждого время от времени расходится тихое кольцо (круги на воде), от буя с тревогой — частые
 * красные, а новая тревога пускает по воде большую волну. Рисуется на одном холсте поверх схемы,
 * 30 кадров в секунду; при приближении холст гаснет и появляется на новом масштабе.
 */
export default function LiveDelta({ area, buoys, alerts }: { area: Bounds; buoys: Buoy[]; alerts: Alert[] }) {
  const map = useMap();
  const live = useRef({ buoys, alerts });
  live.current = { buoys, alerts };

  useEffect(() => {
    const cv = document.createElement('canvas');
    cv.className = 'live-delta';
    cv.setAttribute('aria-hidden', 'true');
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '450', opacity: '0', transition: 'opacity .35s ease' });
    map.getContainer().appendChild(cv);
    const ctx = cv.getContext('2d')!;
    const still = reducedMotion();
    let lines: Line[] = [], rivers: Path2D | null = null, streams: Path2D | null = null;
    let raf = 0, last = 0, zooming = false, w = 0, h = 0, dpr = 1;
    let wave: { id: string; t0: number } | null = null;
    let seenAlert = live.current.alerts.find((a) => a.status === 'new')?.id ?? null;

    const size = () => {
      const s = map.getSize();
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = s.x; h = s.y;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    /** Пути в точках слоя на текущем масштабе: мелочь короче 2 px отбрасывается */
    const project = () => {
      rivers = new Path2D(); streams = new Path2D();
      for (const ln of lines) {
        const path = ln.river ? rivers : streams;
        let px = NaN, py = NaN;
        ln.pts.forEach((ll, i) => {
          const p = map.latLngToLayerPoint(ll);
          if (i === 0) { path.moveTo(p.x, p.y); px = p.x; py = p.y; return; }
          if (Math.abs(p.x - px) + Math.abs(p.y - py) < 2 && i < ln.pts.length - 1) return;
          path.lineTo(p.x, p.y); px = p.x; py = p.y;
        });
      }
    };
    const draw = (now: number) => {
      const t = now / 1000;
      const day = currentTheme() === 'day';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const o = map.layerPointToContainerPoint(L.point(0, 0));
      // только внутри района: снаружи карта приглушена
      const a = map.latLngToContainerPoint(L.latLng(area[1][0], area[0][1]));
      const b = map.latLngToContainerPoint(L.latLng(area[0][0], area[1][1]));
      ctx.save();
      ctx.beginPath(); ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.clip();
      ctx.translate(o.x, o.y);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // русла больше не подсвечиваются бегущими линиями: живость карте даёт дымка (MapHaze)
      ctx.restore();
      if (still) return;
      // буи слушают воду: редкие тихие кольца; у тревоги — частые красные
      const { buoys: bs, alerts: al } = live.current;
      const listen = day ? '94,106,87' : '201,212,188';
      bs.forEach((bu, i) => {
        if (bu.status === 'offline') return;
        const p = map.latLngToContainerPoint(L.latLng(bu.lat, bu.lon));
        const alarm = bu.status === 'alert';
        const period = alarm ? 1.6 : 7, life = alarm ? 1.6 : 2.6;
        const ph = (t + i * 1.37) % period;
        if (ph > life) return;
        const k = ph / life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 + k * (alarm ? 46 : 34), 0, Math.PI * 2);
        ctx.strokeStyle = alarm ? `rgba(239,68,68,${0.6 * (1 - k)})` : `rgba(${listen},${0.35 * (1 - k)})`;
        ctx.lineWidth = alarm ? 1.6 : 1;
        ctx.stroke();
      });
      // новая тревога: большая волна от буя по воде
      const fresh = al.find((x) => x.status === 'new');
      if (fresh && fresh.id !== seenAlert) wave = { id: fresh.buoy_id, t0: t };
      seenAlert = fresh?.id ?? null;
      if (wave) {
        const k = (t - wave.t0) / 4;
        const bu = bs.find((x) => x.id === wave!.id);
        if (k >= 1 || !bu) wave = null;
        else {
          const p = map.latLngToContainerPoint(L.latLng(bu.lat, bu.lon));
          for (let j = 0; j < 3; j++) {
            const kk = k - j * 0.08;
            if (kk <= 0) continue;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 20 + kk * Math.max(w, h) * 0.5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239,68,68,${0.45 * (1 - kk)})`;
            ctx.lineWidth = 2 - j * 0.5;
            ctx.stroke();
          }
        }
      }
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || introCovering() || zooming || now - last < 33) return;
      last = now;
      draw(now);
    };
    const onZoomStart = () => { zooming = true; cv.style.opacity = '0'; };
    const onZoomEnd = () => { project(); zooming = false; draw(performance.now()); cv.style.opacity = '1'; };
    const onResize = () => { size(); draw(performance.now()); };

    let alive = true;
    size();
    loadDelta().then((fc) => {
      if (!alive) return;
      lines = linesIn(fc, area);
      project();
      draw(performance.now());
      cv.style.opacity = '1';
      if (!still) raf = requestAnimationFrame(frame);
    }).catch(() => { /* без подложки карта всё равно работает */ });
    map.on('zoomstart', onZoomStart);
    map.on('zoomend viewreset', onZoomEnd);
    map.on('resize', onResize);
    map.on('move', () => { if (still) draw(performance.now()); });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      map.off('zoomstart', onZoomStart);
      map.off('zoomend viewreset', onZoomEnd);
      map.off('resize', onResize);
      cv.remove();
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
