import { useEffect, useState } from 'react';

export type Route = 'map' | 'alerts' | 'stats' | 'forecast' | 'buoys' | 'evidence';
export const ROUTES: Route[] = ['map', 'alerts', 'stats', 'forecast', 'buoys', 'evidence'];

const parse = (): Route => {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(r) ? r : 'map';
};

/** Раздел из адреса (#/stats): работает «назад» в браузере и ссылки на раздел. */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => { if (r !== parse()) location.hash = `/${r}`; }];
}
