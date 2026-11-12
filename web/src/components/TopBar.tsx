import { useEffect, useState } from 'react';
import type { Mode } from '../types';
import { fmtHM } from '../format';

const MODE: Record<Mode, { label: string; color: string }> = {
  calm: { label: 'Спокойно', color: 'text-accent' },
  alertness: { label: 'Настороженность', color: 'text-warn' },
  alarm: { label: 'Тревога', color: 'text-alert' },
  intercept: { label: 'Перехват', color: 'text-alert' },
};
const DOT: Record<Mode, string> = { calm: 'bg-accent', alertness: 'bg-warn', alarm: 'bg-alert', intercept: 'bg-alert' };

interface Props {
  mode: Mode | null; online: boolean; basemap: 'scheme' | 'tiles';
  onBasemap: (b: 'scheme' | 'tiles') => void; onDemo: () => void; onReset: () => void;
}

export default function TopBar({ mode, online, basemap, onBasemap, onDemo, onReset }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const m = mode ? MODE[mode] : null;
  const btn = 'h-7 rounded-chip border border-line px-2.5 text-[11px] font-medium text-muted hover:text-primary';
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex items-center gap-4">
        <img src="/brand/404-lockup-horizontal-cream.svg" alt="404" className="h-[18px] w-auto" />
        <span className="hidden font-mono text-[10px] tracking-[.08em] text-muted lg:inline">СЕКТОРЫ 1–9 · ДЕЖУРСТВО</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-1 sm:flex" role="group" aria-label="Подложка карты">
          <button className={`${btn} ${basemap === 'scheme' ? '!text-primary border-grey' : ''}`} onClick={() => onBasemap('scheme')}>Схема</button>
          <button className={`${btn} ${basemap === 'tiles' ? '!text-primary border-grey' : ''}`} onClick={() => onBasemap('tiles')} title="Нужен интернет">Карта</button>
        </div>
        <button className={btn} onClick={onDemo}>Демо</button>
        <button className={`${btn} hidden sm:inline-block`} onClick={onReset}>Сброс</button>
        <span className="font-mono text-[13px] font-medium tabular-nums">{fmtHM(now)}</span>
        {online && m ? (
          <span className={`flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[.08em] ${m.color}`}>
            <span className={`h-[7px] w-[7px] rounded-full ${DOT[mode!]}`} />{m.label}
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-grey">Нет связи</span>
        )}
      </div>
    </header>
  );
}
