import type { ReactNode } from 'react';
import { useTween } from '../motion';

/** Заголовок появляется по словам: каждое выезжает снизу из-под маски. */
export function Words({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <span className="words" aria-label={text}>
      {text.split(' ').map((w, i) => (
        <span key={i} className="word" aria-hidden><span style={{ animationDelay: `${delay + i * 70}ms` }}>{w}</span>{' '}</span>
      ))}
    </span>
  );
}

/** Прокручиваемая страница раздела с заголовком. */
export function Page({ title, lead, aside, children }: { cap?: string; title: string; lead?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-6 md:px-8 md:pt-9">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[640px]">
            <h1 className="text-[30px] font-semibold leading-[36px] tracking-[-.015em] md:text-[38px] md:leading-[44px]"><Words text={title} /></h1>
            {lead && <p className="enter mt-3 text-[14px] leading-[22px] text-muted" style={{ animationDelay: '180ms' }}>{lead}</p>}
          </div>
          {aside && <div className="enter" style={{ animationDelay: '240ms' }}>{aside}</div>}
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
