import type { ReactNode } from 'react';
import { useTween } from '../motion';

/** Прокручиваемая страница раздела с заголовком. */
export function Page({ cap, title, lead, aside, children }: { cap: string; title: string; lead?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-6 md:px-8 md:pt-8">
        <header className="enter mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[640px]">
            <div className="cap">{cap}</div>
            <h1 className="mt-1.5 text-[28px] font-semibold leading-[34px] tracking-[-.01em] md:text-[34px] md:leading-[40px]">{title}</h1>
            {lead && <p className="mt-2 text-[14px] leading-[21px] text-muted">{lead}</p>}
          </div>
          {aside}
        </header>
        {children}
      </div>
    </div>
  );
}

export function Card({ title, note, children, className = '', delay = 0 }: { title?: ReactNode; note?: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  return (
    <section className={`card enter ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {(title || note) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {note && <span className="text-[12px] text-muted">{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Показатель: подпись, число (досчитывает при появлении), пояснение. */
export function Kpi({ label, value, suffix = '', hint, tone = '', delay = 0, digits = 0 }: {
  label: string; value: number | null; suffix?: string; hint?: ReactNode; tone?: string; delay?: number; digits?: number;
}) {
  const v = useTween(value ?? 0, 1000);
  return (
    <div className="card enter !p-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`mt-1 font-light tabular-nums text-[32px] leading-[38px] tracking-[-.02em] ${tone}`}>
        {value == null ? '—' : v.toFixed(digits).replace('.', ',')}<span className="ml-1 text-[15px] text-muted">{suffix}</span>
      </div>
      {hint && <div className="mt-1 text-[12px] leading-4 text-muted">{hint}</div>}
    </div>
  );
}

export const Loading = () => (
  <div className="grid h-40 place-items-center text-[13px] text-muted"><span className="animate-pulse">Загружаю…</span></div>
);

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** «2026-11-13» → { d: 13, m: 'ноября', wd: 'пт', short: '13.11' } */
export const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { d, m: MONTHS[m - 1], wd: WD[wd], short: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}` };
};
