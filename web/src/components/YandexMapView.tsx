/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { target, type State } from '../types';
import { km, plural } from '../format';
import { loadYmaps } from '../yandex';
import { BUOY_STATUS, areaOf, distanceKm, esc, gridTicks, isCompact, maskRings, pad, type Bounds, type MapHandle, type Selection } from '../geo';
import { reducedMotion } from '../motion';
import { WARN } from '../design';

const C = { accent: '#7A866F', warn: WARN.night, alert: '#EF4444', primary: '#E2E8F0', mask: '#0B1628' };
// зазор вокруг района [сверху, справа, снизу, слева]: видна граница, кнопки и легенда её не закрывают
const ZOOM_MARGIN = [64, 64, 64, 28];
const easeOut = (k: number) => 1 - (1 - k) ** 3;

/**
 * Анимация параметра объекта Яндекса: геометрию и линии Яндекс рисует сам, CSS до них не достаёт,
 * поэтому прорисовку рамки, проявление связей и бег пунктира ведём по кадрам. Возвращает отмену.
 */
function tween(ms: number, delay: number, step: (k: number) => void, done?: () => void) {
  let raf = 0;
  const t0 = performance.now() + delay;
  const tick = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    step(easeOut(k));
    if (k < 1) raf = requestAnimationFrame(tick); else done?.();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Точки периметра района на доле k обхода (рамка «прорисовывается», как на схеме) */
function partialRing(ring: [number, number][], k: number) {
  const seg = ring.slice(1).map((p, i) => Math.hypot(p[0] - ring[i][0], p[1] - ring[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) * k;
  const out: [number, number][] = [ring[0]];
  for (let i = 0; i < seg.length && left > 0; i++) {
    const f = Math.min(1, left / seg[i]);
    out.push([ring[i][0] + (ring[i + 1][0] - ring[i][0]) * f, ring[i][1] + (ring[i + 1][1] - ring[i][1]) * f]);
    left -= seg[i];
  }
  return out.length > 1 ? out : [ring[0], ring[0]];
}

interface Props extends Selection { state: State; handle: MutableRefObject<MapHandle | null>; onFail: (why: string) => void; margin?: number[] }

/**
 * Яндекс Карты, «Гибрид»: спутниковый снимок дельты с подписями.
 * Карта не уходит за район дежурства: панорама ограничена, снаружи — затемнение.
 * Поверх — слой 404: сектора, связи буёв, буи, катер инспектора и маршрут перехвата.
 */
export default function YandexMapView({ state, handle, onFail, selected, onSelect, margin = ZOOM_MARGIN }: Props) {
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const el = useRef<HTMLDivElement>(null);
  const ym = useRef<any>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const layouts = useRef<Record<string, any>>({});
  const marks = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);
  const area = useMemo(() => areaOf(state.sectors), [state.sectors]);
  // первое появление слоя 404 — от момента, когда Яндекс готов (API грузится секунду-другую;
  // раньше «загрузка» отсчитывалась от открытия страницы и успевала кончиться до появления буёв)
  const boot = useRef(!reducedMotion());
  const anims = useRef<(() => void)[]>([]);
  const moving = useRef(false);
  const selRef = useRef(selected);
  selRef.current = selected;
  /** Выделение — классом на живом значке: без пересоздания он плавно увеличивается, как на схеме */
  const paintSelection = () => {
    el.current?.querySelectorAll<HTMLElement>('.buoy[data-id]').forEach((b) => b.classList.toggle('buoy--selected', b.dataset.id === selRef.current));
  };

  useEffect(() => {
    if (!ready || !boot.current) return;
    el.current?.classList.add('booting');
    const t = window.setTimeout(() => { boot.current = false; el.current?.classList.remove('booting'); }, 2800);
    return () => window.clearTimeout(t);
  }, [ready]);

  // если Яндекс сам перерисует значок (смена статуса, масштаб), выделение возвращается на новый
  useEffect(() => {
    if (!el.current) return;
    // Яндекс при приближении без конца добавляет и убирает плитки — обход всего дерева на каждый кадр тормозил;
    // проверяем выделение не чаще раза в 200 мс
    let timer = 0;
    const mo = new MutationObserver(() => { if (!timer) timer = window.setTimeout(() => { timer = 0; paintSelection(); }, 200); });
    mo.observe(el.current, { childList: true, subtree: true });
    return () => { mo.disconnect(); window.clearTimeout(timer); anims.current.forEach((c) => c()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        const fitArea = (duration = 0) => m.setBounds(area, { checkZoomRange: true, zoomMargin: margin, duration });
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
        // пока карта едет или приближается, лишнее не перерисовываем
        m.events.add('actionbegin', () => { moving.current = true; });
        m.events.add('actionend', () => { moving.current = false; });

        layouts.current = {
          buoy: y.templateLayoutFactory.createClass(
            '<div class="buoy buoy--{{ properties.status }}" data-id="{{ properties.id }}" style="--i:{{ properties.i }};--d:{{ properties.d }}s">'
            + '{% if properties.status == "alert" %}<span class="pulse"></span><span class="pulse p2"></span>{% endif %}'
            + '<span class="map-label">{{ properties.name }}</span></div>'),
          inspector: y.templateLayoutFactory.createClass('<div class="inspector"><span class="map-label">Вы</span></div>'),
          sector: y.templateLayoutFactory.createClass(
            '<div class="sector-label {{ properties.hot }}">{{ properties.n }}{% if properties.hot %}<span>· риск</span>{% endif %}</div>'),
          label: y.templateLayoutFactory.createClass('<div class="route-label">{{ properties.text }}</div>'),
          lat: y.templateLayoutFactory.createClass('<span class="tick tick--lat">{{ properties.text }}</span>'),
          lon: y.templateLayoutFactory.createClass('<span class="tick tick--lon">{{ properties.text }}</span>'),
        };

        // всё за пределами района — затемнено, сам район обведён; снимок внутри чуть приглушён тёмной заливкой
        // (вместо CSS-фильтра на плитках: он пересчитывался каждый кадр и тормозил приближение)
        m.geoObjects.add(new y.Polygon(maskRings(area), {}, {
          fillColor: C.mask, fillOpacity: 0.72, strokeWidth: 0, fillRule: 'evenOdd', interactivityModel: 'default#transparent',
        }));
        m.geoObjects.add(new y.Rectangle(area, {}, {
          fillColor: C.mask, fillOpacity: 0.3, strokeWidth: 0, interactivityModel: 'default#transparent',
        }));
        // рамка района прорисовывается по периметру, как на схеме
        const ring: [number, number][] = [[area[0][0], area[0][1]], [area[1][0], area[0][1]], [area[1][0], area[1][1]], [area[0][0], area[1][1]], [area[0][0], area[0][1]]];
        const frame = new y.Polyline(boot.current ? [ring[0], ring[0]] : ring, {}, {
          strokeColor: C.primary, strokeOpacity: 0.55, strokeWidth: 1.5, interactivityModel: 'default#transparent',
        });
        m.geoObjects.add(frame);
        if (boot.current) anims.current.push(tween(1800, 200, (k) => frame.geometry.setCoordinates(partialRing(ring, k))));
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
  const key = JSON.stringify([state.buoys.map((b) => b.status), hot, active.map((a) => [a.id, a.status, a.estimate])]);
  // hintContent у Яндекса — HTML: имя буя экранируем (docs/audit/05-frontend.md, W9)
  const hint = (b: State['buoys'][number]) => `${esc(b.name)} · ${BUOY_STATUS[b.status]} · сектор ${b.sector} · батарея ${b.battery} %`;

  useEffect(() => {
    if (!ready) return;
    const y = ym.current, L = layouts.current, g = layer.current;
    g.removeAll();
    const byId = Object.fromEntries(state.buoys.map((b) => [b.id, b]));
    const flat = { interactivityModel: 'default#transparent' };
    const stop: (() => void)[] = [];
    // линии одной группы проявляются вместе: прозрачность задаётся коллекции, линии её наследуют
    const group = (opacity: number, delay: number) => {
      const c = new y.GeoObjectCollection({}, { strokeOpacity: boot.current ? 0 : opacity });
      g.add(c);
      if (boot.current) stop.push(tween(1000, delay, (k) => c.options.set('strokeOpacity', opacity * k)));
      return c;
    };
    const grid = group(0.3, 700), linksOk = group(0.75, 800), linksAlarm = group(0.9, 800);

    for (const s of state.sectors) {
      const isHot = hot.includes(s.n);
      (isHot ? g : grid).add(new y.Rectangle([[s.south, s.west], [s.north, s.east]], {}, isHot
        ? { ...flat, fillColor: C.warn, fillOpacity: 0.14, strokeColor: C.warn, strokeOpacity: 0.95, strokeWidth: 2 }
        : { ...flat, fill: false, strokeColor: C.primary, strokeWidth: 1 }));
      g.add(new y.Placemark([s.north, s.west], { n: s.n, hot: isHot ? 'hot' : '' }, {
        ...flat, iconLayout: L.sector, iconOffset: [6, 6], zIndex: 100,
      }));
    }
    for (const [a, b] of state.links) {
      if (!byId[a] || !byId[b]) continue;
      const alarm = byId[a].status === 'alert' || byId[b].status === 'alert';
      (alarm ? linksAlarm : linksOk).add(new y.Polyline([[byId[a].lat, byId[a].lon], [byId[b].lat, byId[b].lon]], {}, {
        ...flat, strokeColor: alarm ? C.alert : '#A9B79C', strokeWidth: alarm ? 2 : 1.5, strokeStyle: 'dot',
      }));
    }
    // где катер: оценка по громкости у нескольких буёв — круг неопределённости и точка в центре
    const est = active.find((a) => a.estimate)?.estimate;
    if (est) {
      g.add(new y.Circle([[est.lat, est.lon], est.radius_km * 1000], { hintContent: `где катер ± ${km(est.radius_km)} · по громкости у ${plural(est.buoys, ['буя', 'буёв', 'буёв'])}` }, {
        fillColor: C.alert, fillOpacity: 0.1, strokeColor: C.alert, strokeOpacity: 0.9, strokeWidth: 2, strokeStyle: 'dash',
      }));
      g.add(new y.Circle([[est.lat, est.lon], 120], {}, { ...flat, fillColor: C.alert, fillOpacity: 0.95, strokeWidth: 0 }));
    }
    const intercept = active.find((a) => a.status === 'intercept');
    if (intercept) {
      const [ilat, ilon] = state.inspector;
      const [tlat, tlon] = target(intercept);
      const route = new y.Polyline([[ilat, ilon], [tlat, tlon]], {}, {
        ...flat, strokeColor: C.primary, strokeWidth: 3, strokeStyle: 'dash',
      });
      g.add(route);
      // пунктир маршрута бежит к цели, как на схеме; каждая смена стиля перерисовывает линию в Яндексе, поэтому редко
      if (!reducedMotion()) {
        let raf = 0, last = 0;
        const run = (now: number) => {
          raf = requestAnimationFrame(run);
          if (now - last < 80 || moving.current) return;      // 12 кадров в секунду; пока карта двигается — стоит
          last = now;
          try {
            route.options.set('strokeStyle', { style: 'dash', offset: -((now / 1000) * 5) % 7 });
          } catch {                              // старый Яндекс без сдвига пунктира — просто пунктир
            cancelAnimationFrame(raf);
            route.options.set('strokeStyle', 'dash');
          }
        };
        raf = requestAnimationFrame(run);
        stop.push(() => cancelAnimationFrame(raf));
      }
      g.add(new y.Placemark([(ilat + tlat) / 2, (ilon + tlon) / 2], { text: km(distanceKm(state.inspector, [tlat, tlon])) }, {
        ...flat, iconLayout: L.label,
      }));
    }
    marks.current = {};
    state.buoys.forEach((b, i) => {
      const r = b.status === 'alert' ? 12 : 9;
      const pm = new y.Placemark([b.lat, b.lon], {
        id: b.id, status: b.status, name: b.name, i, d: ((i * 0.83) % 3.6).toFixed(2), hintContent: hint(b),
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
    return () => stop.forEach((c) => c());
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // выделение меняет только класс живого значка (без перерисовки — с плавным увеличением)
  useEffect(() => {
    if (!ready) return;
    paintSelection();
    for (const [id, pm] of Object.entries(marks.current)) {
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
