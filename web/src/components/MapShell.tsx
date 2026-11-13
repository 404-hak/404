import { useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { State } from '../types';
import type { MapHandle, Selection } from '../geo';
import { hasYandexKey } from '../yandex';
import MapView, { type FitPad } from './MapView';
import YandexMapView from './YandexMapView';


type Basemap = 'photo' | 'scheme';
const ORDER: Basemap[] = ['photo', 'scheme'];

function Btn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className="map-ctl-btn grid h-9 w-9 place-items-center text-primary hover:bg-white/5 [&+&]:border-t [&+&]:border-line">
      {children}
    </button>
  );
}

const Ring = ({ c }: { c: string }) => (
  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[2.5px]" style={{ borderColor: c }}>
    <span className="h-1 w-1 rounded-full" style={{ background: c }} />
  </span>
);

/** Ширина элемента (для выбора вида легенды). */
function useWidth(ref: RefObject<HTMLElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Широкая карта — легенда строкой внизу; узкая — карточка по кнопке «Что на карте?». */
function Legend({ intercept, inline, links = true, folded = false }: { intercept: boolean; inline: boolean; links?: boolean; folded?: boolean }) {
  // в «Карте — всё» легенда свёрнута в кнопку: карта не должна закрываться
  const [open, setOpen] = useState<boolean | null>(folded ? false : null);
  const shown = open ?? inline;
  const row = 'flex items-center gap-2 whitespace-nowrap';
  // в строке подписи короче, в карточке — полные
  const items = (
    <>
      <span className={row}><span className="ml-[3px] mr-[3px] h-2 w-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_rgb(var(--rgb-primary)/.2)]" />{inline ? 'Вы — катер' : 'Вы — катер инспектора'}</span>
      <span className={row}><span className="h-3 w-3.5 shrink-0 rounded-[2px] border-[1.5px] border-warn bg-warn/15" />{inline ? 'Высокий риск' : 'Сектор высокого риска'}</span>
      {links && <span className={row}><span className="w-3.5 shrink-0 border-t-2 border-dotted border-accent" />{inline ? 'Связь буёв' : 'Связь между буями'}</span>}
      {intercept && <span className={row}><span className="w-3.5 shrink-0 border-t-2 border-dashed border-primary" />Маршрут перехвата</span>}
    </>
  );
  const buoys = (
    <>
      <span className={row}><Ring c="var(--c-accent)" />норма</span>
      <span className={row}><Ring c="var(--c-warn)" />внимание</span>
      <span className={row}><Ring c="var(--c-alert)" />тревога</span>
      <span className={row}><Ring c="var(--c-grey)" />нет связи</span>
    </>
  );
  const close = (
    <button type="button" onClick={() => setOpen(false)} aria-label="Скрыть легенду" title="Скрыть легенду"
      className="-m-1 p-1 text-muted hover:text-primary">✕</button>
  );

  if (!shown) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="map-legend-btn pointer-events-auto rounded-[9px] border border-line bg-bg/90 px-3 py-2 text-[12px] font-medium">
        Что на карте?
      </button>
    );
  }
  if (inline) {
    return (
      <div className="pointer-events-auto flex w-fit flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line bg-bg/90 px-3 py-2 text-[12px] leading-4">
        <span className="whitespace-nowrap text-muted">Буи:</span>{buoys}
        <span className="h-4 border-l border-line" />{items}{close}
      </div>
    );
  }
  return (
    <div className="pointer-events-auto w-[236px] rounded-[12px] border border-line bg-bg/90 p-3 text-[12px] leading-4">
      <div className="mb-2.5 flex items-center justify-between"><span className="cap">Что на карте</span>{close}</div>
      <div className="mb-1.5 text-muted">Акустические буи</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">{buoys}</div>
      <div className="mt-3 space-y-1.5 border-t border-line pt-3">{items}</div>
    </div>
  );
}

/** Карта с одинаковым управлением для спутника и схемы. */
/** Свободная от шапки, листа и дока часть карты (раскладка «Карта — всё») */
export type Insets = { top: number; right: number; bottom: number; left: number };

export default function MapShell({ state, handle, selected, onSelect, live = false, insets }: {
  state: State; handle: MutableRefObject<MapHandle | null>; live?: boolean; insets?: Insets;
} & Selection) {
  // в «Карте — всё» по умолчанию схема: на ней течёт живая дельта; спутник — по кнопке
  const [basemap, setBasemap] = useState<Basemap>(hasYandexKey && !live ? 'photo' : 'scheme');
  // район вписывается так, чтобы его не закрывали переключатель сверху, буи масштаба справа и «Что на карте?» снизу
  const pad: FitPad | undefined = insets && { tl: [insets.left + 28, insets.top + 64], br: [insets.right + 64, insets.bottom + 72] };
  const margin = insets && [insets.top + 36, insets.right + 64, insets.bottom + 36, insets.left + 28];
  const [notice, setNotice] = useState<string | null>(null);
  const intercept = state.alerts.some((a) => a.status === 'intercept');
  const root = useRef<HTMLDivElement>(null);
  // строкой — только если свободной части карты хватает на одну строку
  const inline = useWidth(root) - (insets ? insets.left + insets.right : 0) >= (insets ? 760 : 1000);

  const seg = (on: boolean) =>
    `ui-seg-btn relative z-10 h-8 w-[78px] text-[12px] font-medium rounded-[7px] ${on ? 'text-bg' : 'text-muted hover:text-primary'} disabled:cursor-not-allowed disabled:opacity-40`;

  return (
    <div ref={root} className="relative h-full w-full overflow-hidden">
      {basemap === 'photo' ? (
        <YandexMapView state={state} handle={handle} selected={selected} onSelect={onSelect} margin={margin} onFail={(why) => {
          // кнопка «Спутник» остаётся активной: нажатие повторит загрузку без перезагрузки страницы
          setBasemap('scheme');
          setNotice(`Спутник недоступен: ${why}. Показана офлайн-схема — кнопка «Спутник» попробует снова.`);
        }} />
      ) : (
        <MapView state={state} handle={handle} selected={selected} onSelect={onSelect} live={live} pad={pad} />
      )}

      {/* глубина по краям и свечение цвета режима; в тревоге край пульсирует */}
      <div className="map-vignette pointer-events-none absolute inset-0 z-[1050]" />
      <div className="map-glow pointer-events-none absolute inset-0 z-[1050]" />

      <div className="pointer-events-none absolute inset-0 z-[1100] transition-[inset] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]" style={insets && { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }}>
        {/* подложка: светлая плашка переезжает к выбранной кнопке */}
        <div className="map-seg fade-in pointer-events-auto absolute right-3 top-3 flex rounded-[10px] border border-line bg-bg/90 p-[3px] shadow-[0_8px_24px_var(--c-shadow)]"
          role="group" aria-label="Подложка карты">
          <span aria-hidden className="map-seg-plate absolute bottom-[3px] left-[3px] top-[3px] w-[78px] rounded-[7px] bg-primary transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{ transform: `translateX(${ORDER.indexOf(basemap) * 78}px)` }} />
          <button type="button" className={seg(basemap === 'photo')} disabled={!hasYandexKey}
            onClick={() => { setNotice(null); setBasemap('photo'); }}
            title={hasYandexKey ? 'Спутниковый снимок (Яндекс Карты)' : 'Нужен ключ Яндекс Карт (VITE_YANDEX_MAPS_KEY)'}>Спутник</button>
          <button type="button" className={seg(basemap === 'scheme')} onClick={() => { setNotice(null); setBasemap('scheme'); }}
            title="Офлайн-схема, работает без интернета">Схема</button>
        </div>
        {notice && (
          <div className="enter pointer-events-auto absolute right-3 top-[56px] flex max-w-[340px] gap-2 rounded-[9px] border border-line bg-bg/95 py-2 pl-3 pr-2 text-[12px] leading-[17px] text-muted shadow-[0_8px_24px_var(--c-shadow)]">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Закрыть сообщение" title="Закрыть"
              className="-mt-0.5 h-5 shrink-0 px-1 hover:text-primary">✕</button>
          </div>
        )}

        {/* масштаб */}
        <div className="map-ctl fade-in pointer-events-auto absolute bottom-8 right-3 flex flex-col overflow-hidden rounded-[10px] border border-line bg-bg/90 shadow-[0_8px_24px_var(--c-shadow)]">
          <Btn title="Приблизить" onClick={() => handle.current?.zoomIn()}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6"><path d="M7 1v12M1 7h12" /></svg>
          </Btn>
          <Btn title="Отдалить" onClick={() => handle.current?.zoomOut()}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6"><path d="M1 7h12" /></svg>
          </Btn>
          <Btn title="Показать весь район" onClick={() => handle.current?.fitArea()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" /><rect x="5" y="5" width="6" height="6" rx="1" />
            </svg>
          </Btn>
        </div>

        <div className={`fade-in absolute left-3 ${inline ? 'bottom-8 right-16' : live ? 'bottom-8' : 'top-3'}`} style={{ animationDelay: '1.2s' }}>
          <Legend intercept={intercept} inline={inline} links={!live} folded={live} />
        </div>
      </div>
    </div>
  );
}
