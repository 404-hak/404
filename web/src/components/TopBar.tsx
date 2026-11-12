import { useEffect, useState } from 'react';
import type { Mode } from '../types';
import { fmtTime } from '../format';
import { SoundToggle } from './Nav';
import Hydrophone from './Hydrophone';

export const MODE: Record<Mode, { label: string; hint: string; text: string; dot: string; pill: string }> = {
  calm: { label: 'Спокойно', hint: 'угроз нет', text: 'text-accent', dot: 'bg-accent', pill: 'border-accent/40 bg-accent/10' },
  alertness: { label: 'Настороженность', hint: 'высокий риск этой ночью', text: 'text-warn', dot: 'bg-warn', pill: 'border-warn/40 bg-warn/10' },
  alarm: { label: 'Тревога', hint: 'нужно ваше решение', text: 'text-alert', dot: 'bg-alert', pill: 'border-alert/50 bg-alert/10' },
  intercept: { label: 'Перехват', hint: 'катер в пути', text: 'text-alert', dot: 'bg-alert', pill: 'border-alert/50 bg-alert/10' },
};

interface Props { mode: Mode | null; online: boolean; title: string; subtitle: string; onDemo: () => void; onReset: () => void }

export default function TopBar({ mode, online, title, subtitle, onDemo, onReset }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const m = mode && online ? MODE[mode] : null;
  const btn = 'h-8 whitespace-nowrap rounded-[8px] px-3 text-[12px] font-medium';
  return (
    <header className="mode-line bar-in relative z-20 shrink-0 bg-surface/70 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <img src="/brand/404-lockup-horizontal-cream.svg" alt="404" className="h-[18px] w-auto shrink-0 md:hidden" />
          <div className="hidden min-w-0 md:block">
            <div className="truncate text-[15px] font-semibold leading-5">{title}</div>
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
            <button type="button" className={`${btn} btn-shine ink-host bg-white/[.06] text-primary hover:bg-white/10`} onClick={onDemo}>▶ Запустить</button>
            <button type="button" className={`${btn} text-muted hover:text-primary`} onClick={onReset}>Сбросить</button>
          </div>
          <button type="button" className={`${btn} border border-line text-primary sm:hidden`} onClick={onDemo}>▶ Демо</button>
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
