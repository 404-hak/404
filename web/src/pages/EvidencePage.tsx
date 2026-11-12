import { scrambleRef } from '../upkMotion';
import { useEffect, useRef, useState } from 'react';
import type { Alert, ChainCheck, State } from '../types';
import { KIND_TITLE, fmtDM, fmtHM } from '../format';
import { api } from '../live';
import { sound } from '../sound';
import { reducedMotion } from '../motion';
import { Card, Loading, Page } from './common';

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-6)}`;

/**
 * Цепочка доказательств: каждая запись хранит хэш предыдущей, поэтому подмена
 * любой записи ломает все следующие. Кнопка проверяет цепочку на сервере.
 */
export default function EvidencePage({ state }: { state: State }) {
  const [chain, setChain] = useState<Alert[] | null>(null);
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const [scan, setScan] = useState(-1);
  const timer = useRef<number>();
  useEffect(() => { api.alerts(500).then((a) => setChain(a)).catch(() => setChain([])); }, [state.alerts.length]);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const verify = async () => {
    setCheck(null);
    const res = await api.verify().catch(() => null);
    const n = Math.min(chain?.length ?? 0, 24);
    if (reducedMotion() || !n) { setCheck(res); return; }
    let i = 0;
    setScan(0);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      i += 1;
      setScan(i);
      if (i >= n) {
        window.clearInterval(timer.current);
        setScan(-1);
        setCheck(res);
        if (res?.ok) sound.ok();
      }
    }, 45);
  };

  const shown = chain?.slice(0, 24) ?? [];
  return (
    <Page cap="Сеть" title="Доказательства"
      lead="Каждое событие записывается с отпечатком SHA-256, и в него входит отпечаток предыдущей записи и звука, который услышал буй. Поменять задним числом время, буй, уверенность или подменить запись звука нельзя: сломается вся цепочка дальше. Для суда это доказательство, что улику не трогали."
      aside={
        <button type="button" onClick={verify} disabled={!chain || scan >= 0}
          className="ui-btn ui-btn-primary btn-shine ink-host h-10 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-bg hover:bg-white disabled:opacity-60">
          {scan >= 0 ? 'Проверяю…' : 'Проверить цепочку'}
        </button>
      }>
      {check && (
        <div className={`enter mb-4 flex items-center gap-3 rounded-[14px] border px-4 py-3 text-[14px] ${check.ok ? 'border-accent/50 bg-accent/10' : 'border-alert/60 bg-alert/10'}`} role="status">
          <span className={`grid h-7 w-7 place-items-center rounded-full text-[14px] font-bold text-bg ${check.ok ? 'bg-accent' : 'bg-alert'}`}>{check.ok ? '✓' : '!'}</span>
          {check.ok
            ? <>Цепочка цела: проверено {check.checked} записей{check.audio_checked ? <> и {check.audio_checked} звуковых улик</> : null}, ни одна не изменена.</>
            : <>Цепочка нарушена на записи {check.broken_at}: {check.reason ?? 'она или запись перед ней была изменена'}.</>}
        </div>
      )}
      {!chain ? <Loading /> : (
        <Card title="Последние записи" note={`всего ${chain.length}`}>
          <ol className="relative">
            {shown.map((a, i) => {
              const lit = (scan >= 0 && i < scan) || Boolean(check?.ok), now = scan === i;
              return (
                <li key={a.id} className="enter relative grid grid-cols-[22px_1fr] gap-3 pb-3 last:pb-0" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  {i < shown.length - 1 && <span className={`absolute left-[10px] top-6 h-full w-px transition-colors duration-200 ${lit ? 'bg-accent' : 'bg-line'}`} />}
                  <span className={`relative z-[1] mt-1.5 grid h-[21px] w-[21px] place-items-center rounded-full border-2 bg-bg text-[10px] transition-all duration-200 ${now ? 'scale-125 border-primary' : lit ? 'border-accent text-accent' : 'border-line text-transparent'}`}>✓</span>
                  <div className={`rounded-[12px] border px-3.5 py-2.5 transition-colors duration-200 ${now ? 'border-primary/60 bg-white/[.05]' : 'border-line bg-bg/40'}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-[13px]"><b className="font-semibold">{KIND_TITLE[a.kind]}</b> <span className="text-muted">· {a.buoy_name} · {fmtDM(a.ts)} {fmtHM(a.ts)}</span>
                        {a.synthetic && <span className="ml-2 rounded-[4px] border border-line px-1 text-[10px] text-muted">демо</span>}</span>
                      <span ref={scrambleRef} className="keep-mono font-mono text-[11px] text-muted">{a.id}</span>
                    </div>
                    <div className="keep-mono mt-1.5 grid gap-x-4 gap-y-0.5 font-mono text-[11px] sm:grid-cols-2">
                      <span className="truncate" title={a.hash}><span className="text-muted">хэш</span> <span ref={scrambleRef}>{short(a.hash)}</span></span>
                      <span className="truncate" title={a.prev_hash}><span className="text-muted">предыдущий</span> <span ref={scrambleRef}>{short(a.prev_hash)}</span></span>
                      {a.audio_sha256 && (
                        <span className="flex items-center gap-2 truncate sm:col-span-2" title={`SHA-256 звука: ${a.audio_sha256}`}>
                          <span className="text-muted">звук</span> {short(a.audio_sha256)}
                          <audio controls preload="none" src={`/api/alerts/${a.id}/audio`} className="h-7 max-w-[260px] flex-1" aria-label="Звук-улика" />
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {chain.length > shown.length && <p className="mt-3 text-[12px] text-muted">…и ещё {chain.length - shown.length} записей. Проверка идёт по всей цепочке.</p>}
        </Card>
      )}
    </Page>
  );
}
