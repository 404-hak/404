import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { State } from '../types';
import { BUOY_STATUS, areaOf, type MapHandle, type Selection } from '../geo';
import { useTheme } from '../theme';
import { Delta3D } from '../map3d';

interface Props extends Selection { state: State; handle: MutableRefObject<MapHandle | null>; onFail: (why: string) => void }

/**
 * 3D-карта района (three.js): плита дельты по OpenStreetMap, буи, связи, зоны риска, катер и маршрут.
 * Перетаскивание — сдвиг, правая кнопка или два пальца — поворот и наклон, колесо — масштаб.
 * Тема меняется — сцена собирается заново; статусы — пересобирается только слой данных.
 */
export default function Map3D({ state, handle, selected, onSelect, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Delta3D | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const { theme } = useTheme();
  const area = useMemo(() => areaOf(state.sectors), [state.sectors]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const hot = state.forecast.level === 'high' ? state.forecast.hot_sectors : [];
  const active = state.alerts.filter((a) => a.status !== 'resolved');
  const key = JSON.stringify([state.buoys.map((b) => b.status), hot, active.map((a) => [a.id, a.status])]);
  const live = useRef({ state, hot, selected });
  live.current = { state, hot, selected };

  useEffect(() => {
    if (!host.current) return;
    let s: Delta3D;
    try {
      s = new Delta3D(host.current, {
        theme, area,
        onSelect: (id) => pick.current(id),
        onHover: setHover,
      });
    } catch {
      onFail('браузер не дал видеокарту для 3D (WebGL)');
      return;
    }
    scene.current = s;
    s.setData(live.current.state, live.current.hot);
    s.setSelected(live.current.selected);
    handle.current = s.handle;
    return () => { handle.current = null; scene.current = null; s.dispose(); };
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scene.current?.setData(state, hot); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scene.current?.setSelected(selected); }, [selected]);

  // к новой тревоге — подлёт, после её закрытия — обратно ко всему району
  const focus = active.find((a) => a.status === 'new' || a.status === 'intercept');
  const seen = useRef(false);
  useEffect(() => {
    if (focus) handle.current?.flyTo(focus.lat, focus.lon, 11.5);
    else if (seen.current) handle.current?.fitArea();
    seen.current = Boolean(focus);
  }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hb = hover ? state.buoys.find((b) => b.id === hover.id) : null;
  return (
    <div ref={host} className="map-3d relative h-full w-full overflow-hidden">
      {hb && hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[6px] border border-line bg-[var(--c-surface)] px-2 py-1 text-[12px] shadow-[0_8px_24px_var(--c-shadow)]"
          style={{ left: hover.x, top: hover.y - 14 }}>
          {hb.name} · {BUOY_STATUS[hb.status]} · сектор {hb.sector} · батарея {hb.battery} %
        </div>
      )}
      <div className="fade-in pointer-events-none absolute bottom-1.5 right-3 z-10 text-[10px] text-muted" style={{ animationDelay: '2.4s' }}>
        <span className="hidden md:inline">Тянуть — сдвиг · правая кнопка — поворот и наклон · колесо — масштаб · </span>© участники OpenStreetMap
      </div>
    </div>
  );
}
