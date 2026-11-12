import { useEffect, useState } from 'react';
import type { Mode } from '../types';
import { fmtTime } from '../format';
import { SoundToggle, ThemeSwitch } from './Nav';
import Hydrophone from './Hydrophone';
import { showIntro } from '../introBus';
import { design } from '../design';

export const MODE: Record<Mode, { label: string; hint: string; text: string; dot: string; pill: string }> = {
  calm: { label: 'Спокойно', hint: 'угроз нет', text: 'text-accent', dot: 'bg-accent', pill: 'border-accent/40 bg-accent/10' },
  alertness: { label: 'Настороженность', hint: 'высокий риск этой ночью', text: 'text-warn', dot: 'bg-warn', pill: 'border-warn/40 bg-warn/10' },
  alarm: { label: 'Тревога', hint: 'нужно ваше решение', text: 'text-alert', dot: 'bg-alert', pill: 'border-alert/50 bg-alert/10' },
  intercept: { label: 'Перехват', hint: 'катер в пути', text: 'text-alert', dot: 'bg-alert', pill: 'border-alert/50 bg-alert/10' },
};

interface Props { mode: Mode | null; online: boolean; title: string; subtitle: string; onDemo: () => void; onReset: () => void }

const Play = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M6 4.2v11.6c0 .6.7 1 1.2.6l8.6-5.8a.75.75 0 0 0 0-1.2L7.2 3.6c-.5-.4-1.2 0-1.2.6z" /></svg>
);
const Reset = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.5v3.2h3.2" />
  </svg>
);

/**
 * Шапка в оформлении «УПК» — как шапка раздела в панели УПК: слева название и подпись, справа спокойная
 * строка состояния и кнопки-«призраки». Без плашек, пунктирных рамок и моноширинных подписей.
 */
function TopBarUpk({ mode, online, title, subtitle, onDemo, onReset }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const m = mode && online ? MODE[mode] : null;
  const ghost = 'ui-btn ui-btn-ghost ui-btn-sm text-muted hover:text-primary';
  const [place, rest] = title.split(' · ');
  return (
    <header className="upk-head mode-line bar-in relative z-20 shrink-0">
      <div className="flex min-h-[60px] items-center gap-2 px-4 sm:gap-3 md:px-7">
        <button type="button" onClick={showIntro} title="Показать интро" aria-label="Показать интро" className="shrink-0 md:hidden">
          <img src="/brand/404-logo-cream.svg" alt="404" className="on-night h-7 w-auto" />
          <img src="/brand/404-logo-dark.svg" alt="404" className="on-day h-7 w-auto" />
        </button>
        <div className="hidden min-w-0 md:block">
          <div className="truncate text-[17px] font-semibold leading-6 tracking-[-.01em]">
            {place}{rest && <span className="font-normal text-muted"> · {rest}</span>}
          </div>
          <div className="truncate text-[12.5px] leading-[17px] text-muted">{subtitle}</div>
        </div>
        <span className="flex-1" />

        <div className="upk-status flex min-w-0 items-center gap-2 text-[13.5px]" role="status" aria-live="polite"
          title={m ? `Режим: ${m.label.toLowerCase()} — ${m.hint}` : 'Нет связи с сервером'}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${m ? `${mode === 'alarm' || mode === 'intercept' ? 'ping-dot' : 'live-dot'} ${m.dot}` : 'animate-pulse bg-grey'}`} />
          <span className={`truncate font-semibold ${mode === 'alarm' || mode === 'intercept' ? 'text-alert' : ''}`}>{m ? m.label : 'Нет связи'}</span>
          {m && <span className="hidden truncate text-muted xl:inline">{m.hint}</span>}
        </div>

        <span className="upk-sep hidden sm:block" />
        {/* видимость задают обёртки: у кнопок свой display */}
        <span className="hidden items-center gap-1 sm:flex">
          <button type="button" className={ghost} onClick={onDemo} title="Для показа: прогон сценария тревоги"><Play />Демо</button>
          <button type="button" className={ghost} onClick={onReset} title="Вернуть демо в начало"><Reset />Сбросить</button>
        </span>
        <span className="sm:hidden">
          <button type="button" className={`${ghost} !w-8 !px-0`} onClick={onDemo} title="Запустить демо" aria-label="Запустить демо"><Play /></button>
        </span>
        <ThemeSwitch compact />
        <SoundToggle />

        <span className="upk-sep hidden lg:block" />
        <div className="hidden opacity-80 lg:block" title="Гидрофон: что сейчас слышат буи">
          <Hydrophone mode={online ? mode : null} />
        </div>
        <span className="hidden text-[14px] font-semibold tabular-nums sm:block" title="Время астраханское">{fmtTime(now)}</span>
      </div>
    </header>
  );
}

export default function TopBar(props: Props) {
  return design === 'upk' ? <TopBarUpk {...props} /> : <TopBarClassic {...props} />;
}

function TopBarClassic({ mode, online, title, subtitle, onDemo, onReset }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const m = mode && online ? MODE[mode] : null;
  const btn = 'ui-btn ui-btn-sm h-8 whitespace-nowrap rounded-[8px] px-3 text-[12px] font-medium';
  return (
    <header className="mode-line bar-in relative z-20 shrink-0 bg-surface/[.88]">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" onClick={showIntro} title="Показать интро" aria-label="Показать интро" className="shrink-0 md:hidden">
            {/* на узком экране — только знак (брендбук: малые носители), шире — знак с надписью */}
            <img src="/brand/404-logo-cream.svg" alt="404" className="on-night h-7 w-auto sm:hidden" />
            <img src="/brand/404-logo-dark.svg" alt="404" className="on-day h-7 w-auto sm:hidden" />
            <img src="/brand/404-lockup-horizontal-cream.svg" alt="404" className="on-night hidden h-[18px] w-auto sm:block" />
            <img src="/brand/404-lockup-horizontal-dark.svg" alt="404" className="on-day hidden h-[18px] w-auto sm:block" />
          </button>
          <div className="hidden min-w-0 md:block">
            <div className="ui-top-title truncate text-[15px] font-semibold leading-5">{title}</div>
            <div className="truncate text-[11px] leading-4 text-muted">{subtitle}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {m ? (
            <div key={mode} className={`pill relative flex h-8 items-center gap-2 rounded-full border px-3 ${m.pill}`}
              title={`Режим: ${m.label.toLowerCase()} — ${m.hint}`} role="status" aria-live="polite">
              <span className={`${mode === 'alarm' || mode === 'intercept' ? 'ping-dot' : 'live-dot'} h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
              <span className={`text-[12px] font-semibold ${m.text}`}>{m.label}</span>
              <span className="hidden text-[12px] text-muted lg:inline">· {m.hint}</span>
            </div>
          ) : (
            <div className="flex h-8 items-center gap-2 rounded-full border border-line px-3 text-[12px] text-muted" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-grey" />Нет связи с сервером
            </div>
          )}

          <div className="hidden items-center gap-1 rounded-[10px] border border-dashed border-line p-[3px] sm:flex" title="Для показа: прогон сценария тревоги">
            <span className="px-2 font-mono text-[10px] uppercase tracking-[.08em] text-muted">Демо</span>
            <button type="button" className={`${btn} ui-btn-soft btn-shine ink-host bg-white/[.06] text-primary hover:bg-white/10`} onClick={onDemo}>▶ Запустить</button>
            <button type="button" className={`${btn} ui-btn-ghost text-muted hover:text-primary`} onClick={onReset}>Сбросить</button>
          </div>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full border border-line text-[11px] text-primary sm:hidden"
            onClick={onDemo} title="Запустить демо" aria-label="Запустить демо">▶</button>
          <ThemeSwitch compact />
          <SoundToggle />

          <div className="hidden items-center gap-2 rounded-[8px] border border-line px-2 py-1 lg:flex" title="Гидрофон: что сейчас слышат буи">
            <Hydrophone mode={online ? mode : null} />
          </div>
          <div className="hidden flex-col items-end leading-none sm:flex" title="Время астраханское">
            <span className="font-mono text-[13px] font-medium tabular-nums">{fmtTime(now)}</span>
            <span className={`mt-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.1em] ${online ? 'text-accent' : 'text-grey'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${online ? 'live-dot bg-accent' : 'bg-grey'}`} />{online ? 'в эфире' : 'офлайн'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
