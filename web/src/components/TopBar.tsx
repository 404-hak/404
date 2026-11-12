import { useEffect, useState } from 'react';
import type { Mode } from '../types';
import { fmtHM } from '../format';

export const MODE: Record<Mode, { label: string; hint: string; text: string; dot: string; pill: string }> = {
  calm: { label: 'Спокойно', hint: 'угроз нет', text: 'text-accent', dot: 'bg-accent', pill: 'border-accent/40 bg-accent/10' },
  alertness: { label: 'Настороженность', hint: 'высокий риск этой ночью', text: 'text-warn', dot: 'bg-warn', pill: 'border-warn/40 bg-warn/10' },
  alarm: { label: 'Тревога', hint: 'нужно ваше решение', text: 'text-alert', dot: 'bg-alert', pill: 'border-alert/50 bg-alert/10' },
  intercept: { label: 'Перехват', hint: 'катер в пути', text: 'text-alert', dot: 'bg-alert', pill: 'border-alert/50 bg-alert/10' },
};

interface Props { mode: Mode | null; online: boolean; subtitle: string; onDemo: () => void; onReset: () => void }

export default function TopBar({ mode, online, subtitle, onDemo, onReset }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const m = mode && online ? MODE[mode] : null;
  const btn = 'h-8 rounded-[8px] px-3 text-[12px] font-medium';
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-center gap-4">
        <img src="/brand/404-lockup-horizontal-cream.svg" alt="404" className="h-[18px] w-auto shrink-0" />
        <div className="hidden min-w-0 border-l border-line pl-4 md:block">
          <div className="truncate text-[13px] font-semibold leading-4">Дельта Волги · дежурство</div>
          <div className="truncate text-[11px] leading-4 text-muted">{subtitle}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {m ? (
          <div className={`flex h-8 items-center gap-2 rounded-full border px-3 ${m.pill}`} title={`Режим: ${m.label.toLowerCase()} — ${m.hint}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${m.dot} ${mode === 'alarm' ? 'animate-pulse' : ''}`} />
            <span className={`text-[12px] font-semibold ${m.text}`}>{m.label}</span>
            <span className="hidden text-[12px] text-muted lg:inline">· {m.hint}</span>
          </div>
        ) : (
          <div className="flex h-8 items-center gap-2 rounded-full border border-line px-3 text-[12px] text-muted">
            <span className="h-2 w-2 rounded-full bg-grey" />Нет связи с сервером
          </div>
        )}

        <div className="hidden items-center gap-1 rounded-[10px] border border-dashed border-line p-[3px] sm:flex" title="Для показа: прогон сценария тревоги">
          <span className="px-2 font-mono text-[10px] uppercase tracking-[.08em] text-muted">Демо</span>
          <button type="button" className={`${btn} bg-white/[.06] text-primary hover:bg-white/10`} onClick={onDemo}>▶ Запустить</button>
          <button type="button" className={`${btn} text-muted hover:text-primary`} onClick={onReset}>Сбросить</button>
        </div>
        <button type="button" className={`${btn} border border-line text-primary sm:hidden`} onClick={onDemo}>▶ Демо</button>

        <span className="hidden font-mono text-[13px] font-medium tabular-nums sm:inline" title="Время астраханское">{fmtHM(now)}</span>
      </div>
    </header>
  );
}
