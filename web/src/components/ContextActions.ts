import { useEffect, useRef, type MutableRefObject } from 'react';
import type { State } from '../types';
import type { MapHandle } from '../geo';
import type { Route } from '../route';
import { KIND_TITLE, coord } from '../format';
import { BUOY_STATUS } from '../geo';
import { api, can, currentMe } from '../live';
import { contextActions, copyText, pageActions, type MenuItem } from '../upkUi';
import { NAV } from './Nav';
import { currentTheme, setThemePref } from '../theme';
import { floatCursorOn, setFloatCursor, sparkTransition } from '../upkMotion';
import { setSound, soundEnabled } from '../sound';
import { showIntro } from '../introBus';

/**
 * Действия правой кнопки для всего сайта: что под мышью (тревога, буй в списке, снимок со спутника,
 * звук-улика) и общее (разделы, тема, звук, заставка, назад/вперёд). Карта добавляет свои — MapView.
 */
export function useContextActions({ state, route, go, map, select }: {
  state: State | null; route: Route; go: (r: Route) => void; map: MutableRefObject<MapHandle | null>; select: (id: string | null) => void;
}) {
  // последние значения — без пересоздания обработчиков на каждый такт сервера
  const live = useRef({ state, route, go, select });
  live.current = { state, route, go, select };

  useEffect(() => {
    const fly = (lat: number, lon: number, zoom?: number) => {
      const { route: r, go: g } = live.current;
      if (r !== 'map') { g('map'); window.setTimeout(() => map.current?.flyTo(lat, lon, zoom), 450); } else map.current?.flyTo(lat, lon, zoom);
    };
    const off = [
      contextActions('[data-alert-id]', (el) => {
        const a = live.current.state?.alerts.find((x) => x.id === (el as HTMLElement).dataset.alertId);
        if (!a) return null;
        const items: MenuItem[] = [
          { label: 'Показать на карте', ic: 'pin', action: () => fly(a.lat, a.lon, 12) },
        ];
        if (a.status === 'new' && can('duty')) items.push({ label: 'Начать перехват', ic: 'boat', danger: true, action: () => api.setAlertStatus(a.id, 'intercept') });
        if (a.status !== 'resolved' && can('duty')) items.push({ label: a.status === 'new' ? 'Ложная тревога' : 'Задержан — закрыть', ic: 'check',
          action: () => api.setAlertStatus(a.id, 'resolved', a.status === 'new' ? 'false' : 'confirmed') });
        items.push({ label: 'Скопировать координаты', ic: 'copy', action: () => copyText(coord(a.lat, a.lon), 'Координаты скопированы') });
        return { title: `${KIND_TITLE[a.kind]} · ${a.buoy_name}`, items };
      }),
      contextActions('[data-buoy-id]', (el) => {
        const b = live.current.state?.buoys.find((x) => x.id === (el as HTMLElement).dataset.buoyId);
        if (!b) return null;
        return {
          title: `Буй ${b.name} · ${BUOY_STATUS[b.status]}`,
          items: [
            { label: 'Открыть карточку буя', ic: 'buoy', action: () => { live.current.select(b.id); fly(b.lat, b.lon, 12); } },
            { label: 'Скопировать координаты', ic: 'copy', action: () => copyText(coord(b.lat, b.lon), 'Координаты скопированы') },
          ],
        };
      }),
      contextActions('.sat-snap', (el) => {
        const { lat, lon } = (el as HTMLElement).dataset;
        if (!lat || !lon) return null;
        return {
          title: 'Снимок со спутника',
          items: [
            { label: 'Открыть крупно', ic: 'expand', action: () => (el.querySelector('.sat-open') as HTMLElement | null)?.click() },
            { label: 'Показать место на карте', ic: 'pin', action: () => fly(Number(lat), Number(lon), 12.5) },
            { label: 'Скопировать координаты', ic: 'copy', action: () => copyText(coord(Number(lat), Number(lon)), 'Координаты скопированы') },
          ],
        };
      }),
      contextActions('.clip', (el) => {
        const audio = el.querySelector('audio');
        const src = (el as HTMLElement).dataset.src;
        if (!audio || !src) return null;
        return {
          title: 'Звук-улика',
          items: [
            { label: audio.paused ? 'Слушать' : 'Пауза', ic: audio.paused ? 'play' : 'pause', hint: 'Пробел', action: () => (el.querySelector('.clip-play') as HTMLElement | null)?.click() },
            { label: 'С начала', ic: 'refresh', action: () => { audio.currentTime = 0; void audio.play(); } },
            { label: 'Скачать звук', ic: 'download', action: () => { const a = document.createElement('a'); a.href = src; a.download = ''; document.body.append(a); a.click(); a.remove(); } },
          ],
        };
      }),
    ];

    pageActions(() => {
      const { route: r, go: g } = live.current;
      const nav = (window as unknown as { navigation?: { canGoBack: boolean; canGoForward: boolean } }).navigation;
      const theme = currentTheme();
      const on = soundEnabled();
      return [
        {
          tools: [
            { label: 'Назад', ic: 'back', hint: 'Alt+←', disabled: nav ? !nav.canGoBack : false, action: () => history.back() },
            { label: 'Вперёд', ic: 'forward', hint: 'Alt+→', disabled: nav ? !nav.canGoForward : false, action: () => history.forward() },
            { label: 'Обновить', ic: 'refresh', hint: 'Ctrl+R', action: () => location.reload() },
            { label: 'Скопировать ссылку на раздел', ic: 'link', action: () => copyText(location.href, 'Ссылка скопирована') },
            { label: 'Показать весь район', ic: 'fit', action: () => { if (r !== 'map') g('map'); window.setTimeout(() => map.current?.fitArea(), r === 'map' ? 0 : 450); } },
          ],
        },
        {
          label: 'Раздел', ic: 'sections',
          items: NAV.flatMap((s) => s.items).map((it) => ({ label: it.label, checked: it.id === r, action: () => g(it.id) })),
        },
        {
          label: 'Тема', ic: theme === 'day' ? 'sun' : 'moon',
          items: (['night', 'day'] as const).map((p) => ({
            label: p === 'night' ? 'Тёмная' : 'Светлая', ic: p === 'night' ? 'moon' : 'sun', checked: theme === p,
            action: () => { if (currentTheme() !== p) sparkTransition(() => setThemePref(p, false), 980); },
          })),
        },
        { label: on ? 'Выключить звук' : 'Включить звук', ic: on ? 'mute' : 'volume', action: () => setSound(!on) },
        { label: floatCursorOn() ? 'Обычный указатель' : 'Указатель-поплавок', ic: 'select', action: () => setFloatCursor(!floatCursorOn()) },
        { label: 'Показать заставку', ic: 'intro', action: () => showIntro() },
        ...(currentMe().accounts ? [{ label: `Выйти · ${currentMe().name}`, ic: 'back', action: () => api.logout() }] : []),
      ];
    });
    return () => { off.forEach((f) => f()); pageActions(null); };
  }, [map]);
}
