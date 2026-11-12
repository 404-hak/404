import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { State } from '../types';
import { ALERT_RU, EVENT_RU, MAX_S, audioUrl, fmtS, labApi, num, pct0, toWav16k, type ClipRec, type LabResult, type ModelMeta, type Preset, type SceneParams } from '../lab';
import { fmtHM } from '../format';
import Scope from '../components/lab/Scope';
import Timeline from '../components/lab/Timeline';
import { FeaturesDetail, ImpulseDetail, MotorDetail, NatureDetail } from '../components/lab/Details';
import ModelCard from '../components/lab/ModelCard';
import { Card, Page } from './common';

/**
 * Лаборатория нейросети: дайте звук — увидите всё, что слышит и решает буй.
 * Источники: сценарии синтеза (мотор, выстрел, тишина, помехи), свой файл, микрофон, клипы буёв.
 * Здесь ничего не меняется в системе: тревоги не поднимаются, архив катеров не трогается.
 */

const PRESETS: { id: Preset; title: string; text: string; expect: string; glyph: string; water?: boolean }[] = [
  { id: 'motor-archive', title: 'Катер из архива', text: 'Мотор знакомого катера: под водой слышнее всего винт и выхлоп', expect: 'тревога со 2-го клипа, катер узнан', glyph: '⛵' },
  { id: 'motor-new', title: 'Новый катер', text: 'Мотор, которого сеть никогда не слышала', expect: 'тревога, в архиве его нет', glyph: '🚤' },
  { id: 'shot', title: 'Выстрел', text: 'Под водой — глухой и смазанный, иногда с ударом пули о воду', expect: 'тревога «выстрел»', glyph: '✳' },
  { id: 'voices', title: 'Голоса людей', text: 'Разговор в лодке: инспекторы или прохожие', expect: 'сеть узнаёт голоса, тревоги нет', glyph: '🗣' },
  { id: 'imitation', title: 'Выстрел голосом', text: '«Пф», «бах», «тыщ», щелчок языком', expect: 'голоса, а не выстрел — тревоги нет', glyph: '💬' },
  { id: 'night', title: 'Тихая ночь', text: 'Водные насекомые, рыбы, лягушки сверху', expect: 'тревоги нет', glyph: '☾' },
  { id: 'silence', title: 'Тишина как улика', text: 'Природа живёт — и вдруг стихает', expect: 'тревога «тишина»', glyph: '◌' },
  { id: 'thunder', title: 'Гром', text: 'Медленный низкий раскат — не выстрел', expect: 'помеха — тревоги нет', glyph: '⚡' },
  { id: 'wave', title: 'Волна о буй', text: 'Глухие удары по корпусу буя', expect: 'помеха — тревоги нет', glyph: '〰', water: true },
  { id: 'oar', title: 'Удар весла', text: 'Стук о борт — резкий, как выстрел', expect: 'помеха — тревоги нет', glyph: '⌇' },
  { id: 'airplane', title: 'Самолёт вдали', text: 'Гул с доплером — похож на мотор', expect: 'помеха — тревоги нет', glyph: '✈' },
  { id: 'fish', title: 'Всплеск рыбы', text: 'Мягкий всплеск у поверхности', expect: 'помеха — тревоги нет', glyph: '≈' },
  { id: 'rain', title: 'Дождь', text: 'Шипение и щелчки капель по воде', expect: 'помеха — тревоги нет', glyph: '⁘' },
];
const EXPECT: Record<string, string | null> = { 'мотор': 'motor', 'выстрел': 'shot', 'тишина': 'silence', 'фон': null, 'фон (помеха)': null, 'голоса': null };
const EVENT_TONE: Record<string, string> = { background: 'text-primary', motor: 'text-warn', shot: 'text-alert', voice: 'text-[#7FB2E5]' };
const BAR: Record<string, string> = { background: 'bg-[var(--c-bar)]', motor: 'bg-warn', shot: 'bg-alert', voice: 'bg-[#7FB2E5]' };

type Tab = 'scene' | 'own' | 'buoy';

function Seg<T extends string>({ value, set, items }: { value: T; set: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex w-fit rounded-[10px] border border-line bg-bg/70 p-[3px]" role="tablist">
      {items.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => set(v)}
          className={`h-8 rounded-[7px] px-3 text-[12px] font-medium ${value === v ? 'bg-primary text-bg' : 'text-muted hover:text-primary'}`}>{label}</button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, set }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; set: (v: number) => void }) {
  return (
    <label className="block min-w-[190px] flex-1">
      <div className="flex justify-between gap-3 whitespace-nowrap text-[12px]"><span className="text-muted">{label}</span><span className="font-mono">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="sky-range mt-1 w-full" />
    </label>
  );
}

/** Плеер: кнопка, время; позиция на экране спектрограммы двигается напрямую */
function usePlayer(r: LabResult | null) {
  const audio = useRef<HTMLAudioElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  useEffect(() => {
    const a = audio.current;
    if (!a || !r) return;
    let raf = 0, lastT = -1;
    const tick = () => {
      const h = head.current, box = h?.parentElement;
      if (h && box) {
        h.style.opacity = a.currentTime > 0 || !a.paused ? '1' : '0';
        h.style.transform = `translateX(${(a.currentTime / r.duration_s) * box.clientWidth}px)`;
      }
      if (Math.abs(a.currentTime - lastT) > 0.2) { lastT = a.currentTime; setT(a.currentTime); }
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const on = () => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const off = () => { setPlaying(false); tick(); };
    a.addEventListener('play', on);
    a.addEventListener('pause', off);
    a.addEventListener('ended', off);
    a.addEventListener('seeked', tick);
    return () => { cancelAnimationFrame(raf); a.removeEventListener('play', on); a.removeEventListener('pause', off); a.removeEventListener('ended', off); a.removeEventListener('seeked', tick); };
  }, [r]);
  return { audio, head, playing, t };
}

export default function LabPage({ state }: { state: State }) {
  const [tab, setTab] = useState<Tab>('scene');
  const [p, setP] = useState<SceneParams>({ preset: 'motor-archive', vessel: 'boat-A', duration_s: 12, snr_db: 10, activity: 0.7, seed: 1, medium: 'water' });
  const [res, setRes] = useState<LabResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<ModelMeta | null | undefined>(undefined);
  const [clips, setClips] = useState<ClipRec[] | null>(null);
  const [rec, setRec] = useState<{ on: boolean; s: number; level: number }>({ on: false, s: 0, level: 0 });
  const recRef = useRef<{ stop: () => void } | null>(null);
  const player = usePlayer(res);
  const first = useRef(true);

  const run = async (label: string, job: () => Promise<LabResult>) => {
    setBusy(label); setErr(null);
    try {
      const r = await job();
      setRes(r);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const runScene = (q: SceneParams) => run('Нейросеть слушает сцену…', () => labApi.scene(q));
  const runBlob = async (blob: Blob, name: string) => {
    await run('Перекодирую и слушаю…', async () => {
      const { wav, trimmed } = await toWav16k(blob);
      const r = await labApi.analyze(wav, name);
      if (trimmed) setErr(`Запись длиннее ${MAX_S} с — разобраны первые ${MAX_S} с.`);
      return r;
    });
  };

  useEffect(() => {
    labApi.model().then((m) => setMeta(m.available ? m.meta : null)).catch(() => setMeta(null));
    if (first.current) { first.current = false; void runScene(p); }   // страница не пустая: сразу разбор катера из архива
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'buoy') labApi.clips(14).then(setClips).catch(() => setClips([])); }, [tab, state.alerts.length]);

  const pick = (preset: Preset) => {
    const q: SceneParams = { ...p, preset, duration_s: preset === 'silence' ? Math.max(24, p.duration_s) : p.duration_s,
      medium: PRESETS.find((x) => x.id === preset)?.water ? 'water' : p.medium };
    setP(q);
    void runScene(q);
  };

  const record = async () => {
    if (rec.on) { recRef.current?.stop(); return; }
    setErr(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      setErr('Браузер не дал микрофон: разрешите доступ к нему для этой страницы.');
      return;
    }
    const mr = new MediaRecorder(stream);
    const parts: Blob[] = [];
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const t0 = performance.now();
    let raf = 0;
    const meter = () => {
      an.getFloatTimeDomainData(buf);
      let m = 0;
      for (const v of buf) m = Math.max(m, Math.abs(v));
      const s = (performance.now() - t0) / 1000;
      setRec({ on: true, s, level: m });
      if (s >= 20) { stop(); return; }
      raf = requestAnimationFrame(meter);
    };
    const stop = () => { if (mr.state !== 'inactive') mr.stop(); };
    mr.ondataavailable = (e) => parts.push(e.data);
    mr.onstop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((tr) => tr.stop());
      void ctx.close();
      setRec({ on: false, s: 0, level: 0 });
      recRef.current = null;
      const blob = new Blob(parts, { type: mr.mimeType });
      if ((performance.now() - t0) / 1000 < 2) { setErr('Запись короче 2 секунд — нужно хотя бы 2–4 с.'); return; }
      void runBlob(blob, 'Запись с микрофона');
    };
    recRef.current = { stop };
    mr.start();
    raf = requestAnimationFrame(meter);
  };

  const cur = PRESETS.find((x) => x.id === p.preset)!;
  const event = !['night', 'silence', 'rain'].includes(p.preset);

  return (
    <Page cap="Сеть" title="Нейросеть"
      lead="Проверка слуха буя. Дайте звук — сценарий, свой файл, микрофон или клип с буя — и увидите всё, что слышит и решает нейросеть: спектр, вероятности по времени, решение уха буя клип за клипом, гармоники и отпечаток катера, фронт удара и голоса природы. Тревоги здесь не поднимаются, архив не меняется.">

      {/* ---------- источник звука ---------- */}
      <Card className="mb-4" title="Звук для проверки" note={<Seg value={tab} set={setTab} items={[['scene', 'Сценарий'], ['own', 'Свой звук'], ['buoy', 'С буя']]} />}>
        {tab === 'scene' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Seg value={p.medium} set={(m) => { const q = { ...p, medium: m, preset: m === 'air' && p.preset === 'wave' ? 'oar' as Preset : p.preset }; setP(q); void runScene(q); }}
                items={[['water', 'Гидрофон под водой'], ['air', 'Микрофон в воздухе']]} />
              <span className="text-[12px] leading-4 text-muted">
                {p.medium === 'water' ? 'Как на буе: звук из воздуха доходит глухо, мелководье даёт отражения от поверхности и дна.' : 'Как при проверке микрофоном ноутбука или телефона.'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {PRESETS.filter((x) => !(x.water && p.medium === 'air')).map((x) => (
                <button key={x.id} type="button" onClick={() => pick(x.id)} disabled={!!busy}
                  className={`group rounded-[12px] border p-3 text-left transition-colors ${p.preset === x.id ? 'border-primary/60 bg-white/[.06]' : 'border-line hover:border-primary/30 hover:bg-white/[.03]'} disabled:opacity-60`}>
                  <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-white/[.06] text-[13px]">{x.glyph}</span><span className="text-[13px] font-semibold">{x.title}</span></div>
                  <div className="mt-1.5 text-[11px] leading-[15px] text-muted">{x.text}</div>
                  <div className="mt-1 text-[11px] leading-[15px] text-accent">ждём: {x.expect}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <Slider label="Длительность" value={p.duration_s} min={p.preset === 'silence' ? 16 : 4} max={30} step={1} fmt={(v) => `${v} с`} set={(v) => setP({ ...p, duration_s: v })} />
              {event && <Slider label="Громкость над фоном" value={p.snr_db} min={-6} max={24} step={1} fmt={(v) => `${v > 0 ? '+' : ''}${v} дБ`} set={(v) => setP({ ...p, snr_db: v })} />}
              <Slider label={p.preset === 'silence' ? 'Живость до тишины' : 'Живость природы'} value={p.activity} min={0} max={1} step={0.05} fmt={(v) => num(v, 2)} set={(v) => setP({ ...p, activity: v })} />
              {p.preset === 'motor-archive' && (
                <div>
                  <div className="mb-1 text-[12px] text-muted">Катер</div>
                  <Seg value={p.vessel} set={(v) => setP({ ...p, vessel: v })} items={[['boat-A', 'boat-A'], ['boat-B', 'boat-B'], ['boat-C', 'boat-C']]} />
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => runScene(p)}
                  className="btn-shine ink-host h-10 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-bg hover:bg-white disabled:opacity-60">Разобрать</button>
                <button type="button" disabled={!!busy} onClick={() => { const q = { ...p, seed: p.seed + 1 }; setP(q); void runScene(q); }}
                  title="Тот же сценарий, другая случайность: другие лягушки, ветер, проход катера"
                  className="ink-host h-10 rounded-[10px] border border-line px-4 text-[13px] font-semibold hover:bg-white/[.04] disabled:opacity-60">Другой вариант</button>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-muted">{cur.title}: {cur.text.toLowerCase()}. Вариант № {p.seed}.</p>
          </>
        )}

        {tab === 'own' && (
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void runBlob(f, f.name); }}
              className="grid min-h-[132px] cursor-pointer place-items-center rounded-[12px] border border-dashed border-line px-4 text-center hover:border-primary/40 hover:bg-white/[.02]">
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void runBlob(f, f.name); e.target.value = ''; }} />
              <span>
                <span className="block text-[14px] font-medium">Перетащите звук сюда или нажмите</span>
                <span className="mt-1 block text-[12px] text-muted">WAV, MP3, OGG, M4A — до {MAX_S} с; приводится к 16 кГц моно, как у буя</span>
              </span>
            </label>
            <div className="flex flex-col justify-between rounded-[12px] border border-line p-4">
              <div>
                <div className="text-[14px] font-medium">Запись с микрофона</div>
                <div className="mt-1 text-[12px] leading-4 text-muted">До 20 с. Попробуйте: тишина в комнате, шум вентилятора, хлопок в ладоши, видео с мотором лодки.</div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button type="button" onClick={record} disabled={!!busy && !rec.on}
                  className={`ink-host h-10 rounded-[10px] px-4 text-[13px] font-semibold ${rec.on ? 'bg-alert text-bg' : 'bg-primary text-bg hover:bg-white'} disabled:opacity-60`}>
                  {rec.on ? `Стоп · ${fmtS(rec.s)}` : 'Записать'}
                </button>
                {rec.on && <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[.08]"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, rec.level * 140)}%` }} /></span>}
              </div>
            </div>
          </div>
        )}

        {tab === 'buoy' && (
          !clips ? <div className="py-6 text-center text-[13px] text-muted">Загружаю журнал клипов…</div>
            : !clips.length ? <div className="py-6 text-center text-[13px] text-muted">Буи ещё не присылали звук. Запустите симулятор: <span className="font-mono">python -m app.buoysim</span> или «Демо» в шапке.</div>
              : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {clips.map((c) => {
                    const b = state.buoys.find((x) => x.id === c.buoy_id);
                    return (
                      <li key={c.sha256}>
                        <button type="button" disabled={!!busy} onClick={() => run('Нейросеть слушает клип буя…', () => labApi.clip(c.sha256))}
                          className="flex w-full items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-left hover:border-primary/30 hover:bg-white/[.03] disabled:opacity-60">
                          <span className={`text-[13px] font-semibold ${EVENT_TONE[c.event]}`}>{EVENT_RU[c.event]}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{b?.name ?? c.buoy_id} · {fmtHM(c.ts)} · {c.note}</span>
                          {c.alert_id && <span className="rounded-[4px] bg-alert px-1.5 text-[10px] font-bold text-bg">ТРЕВОГА</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
        )}
      </Card>

      {err && <div role="alert" className="enter mb-4 rounded-[12px] border border-warn/50 bg-warn/10 px-4 py-2.5 text-[13px]">{err}</div>}
      {meta === null && <div role="alert" className="mb-4 rounded-[12px] border border-alert/50 bg-alert/10 px-4 py-2.5 text-[13px]">Нейросеть не обучена на этом сервере: запустите <span className="font-mono">tools/ml/train.py</span>.</div>}

      {busy && (
        <div className="mb-4 flex items-center gap-3 rounded-[12px] border border-line bg-bg/40 px-4 py-3 text-[13px]" role="status">
          <span className="flex h-5 items-end gap-[3px]" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} className="lab-bar w-[3px] rounded-full bg-accent" style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
          {busy}
        </div>
      )}

      {res && <Result key={res.id} r={res} player={player} />}

      {meta && (
        <Card className="mt-4" title="Как училась сеть и насколько ей верить" note={`модель ${meta.version}`} delay={120}>
          <ModelCard meta={meta} />
        </Card>
      )}
    </Page>
  );
}

function Result({ r, player }: { r: LabResult; player: ReturnType<typeof usePlayer> }) {
  const main = r.clips.find((c) => c.i === r.main_clip)!;
  const want = r.truth != null ? EXPECT[r.truth] : undefined;
  const got = r.verdict.alerts.map((a) => a.kind);
  const right = want === undefined ? null : want === null ? got.length === 0 : got.includes(want as never);
  const alertLine: ReactNode = got.length
    ? <>Ухо буя подняло тревогу: {r.verdict.alerts.map((a, i) => <b key={i} className="text-alert">{i ? ', ' : ''}{ALERT_RU[a.kind]} (клип {a.clip}, {pct0(a.confidence)})</b>)}.</>
    : <>Тревоги нет: {main.note}.</>;
  const { audio, head, playing, t } = player;

  return (
    <>
      {/* ---------- вердикт ---------- */}
      <section className="card enter mb-4 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="cap">{r.source === 'scene' ? 'сценарий' : r.source === 'buoy' ? 'клип буя' : 'ваш звук'}</span>
            <span>· {r.title}{r.vessel ? ` · ${r.vessel}` : ''}{r.medium ? ` · ${r.medium === 'water' ? 'под водой' : 'в воздухе'}` : ''}</span>
            <span>· {num(r.duration_s, 1)} с · {num(r.level_db, 0)} дБ</span>
            {r.truth && <span className="rounded-[6px] border border-line px-1.5">в звуке: {r.truth}</span>}
          </div>
          <div className="mt-2 text-[13px] text-muted">Нейросеть слышит (клип {main.i}, {fmtS(main.start)}–{fmtS(main.end)})</div>
          <div className={`mt-0.5 text-[34px] font-semibold leading-[40px] tracking-[-.015em] ${EVENT_TONE[main.event]}`}>
            {EVENT_RU[main.event]} <span className="font-light">· {pct0(main.confidence)}</span>
          </div>
          <p className="mt-2 text-[14px] leading-[21px]">{alertLine}</p>
          {right != null && (
            <p className={`mt-2 text-[13px] font-medium ${right ? 'text-accent' : 'text-alert'}`}>
              {right ? (want ? '✓ Совпадает с тем, что на самом деле в звуке.'
                : r.truth === 'голоса' ? (r.clips.some((c) => c.event === 'voice') ? '✓ Сеть узнала голоса людей и тревогу не подняла.' : '✓ Тревоги нет, хотя голоса сеть не выделила.')
                  : '✓ Помеха не обманула сеть — ложной тревоги нет.')
                : `✗ Сеть ошиблась: в звуке ${r.truth}, а ${got.length ? `тревога «${got.map((g) => ALERT_RU[g]).join(', ')}»` : 'тревоги нет'}. Так выглядят её слабые места.`}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <audio ref={audio} src={r.source === 'buoy' && r.sha256 ? `/api/clips/${r.sha256}/audio` : audioUrl(r)} preload="auto" />
            <button type="button" onClick={() => { const a = audio.current; if (a) { if (a.paused) void a.play(); else a.pause(); } }}
              className="grid h-11 w-11 place-items-center rounded-full bg-primary text-bg hover:bg-white" aria-label={playing ? 'Пауза' : 'Слушать'}>
              {playing
                ? <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2.5" y="2" width="3" height="10" rx="1" /><rect x="8.5" y="2" width="3" height="10" rx="1" /></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5z" /></svg>}
            </button>
            <div className="font-mono text-[13px]">{fmtS(t)} <span className="text-muted">/ {fmtS(r.duration_s)}</span></div>
            <span className="text-[12px] text-muted">клик по спектрограмме — с того места</span>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] text-muted">Ответ сети на клип {main.i} и пороги тревоги</div>
          <ul className="space-y-3">
            {r.classes.map((c) => {
              const v = main.probs[c];
              const thr = c === 'motor' ? r.thresholds.motor : c === 'shot' ? r.thresholds.shot : null;
              return (
                <li key={c}>
                  <div className="flex justify-between text-[13px]"><span className={c === main.event ? 'font-semibold' : ''}>{EVENT_RU[c]}</span><span className="font-mono">{num(v * 100, 1)} %</span></div>
                  <div className="relative mt-1 h-2.5 rounded-full bg-white/[.06]">
                    <div className={`bar-grow-x h-full rounded-full ${BAR[c]}`} style={{ width: `${Math.max(1, v * 100)}%` }} />
                    {thr != null && <span className="absolute -inset-y-1 w-[2px] rounded bg-primary" style={{ left: `${thr * 100}%` }} title={`порог ${num(thr * 100, 1)} %`} />}
                  </div>
                </li>
              );
            })}
            <li>
              <div className="flex justify-between text-[13px]"><span>Живость природы</span><span className="font-mono">{num(main.activity, 2)}</span></div>
              <div className="mt-1 h-2.5 rounded-full bg-white/[.06]"><div className="bar-grow-x h-full rounded-full bg-accent" style={{ width: `${Math.max(1, main.activity * 100)}%` }} /></div>
            </li>
          </ul>
          <p className="mt-3 text-[11px] leading-[15px] text-muted">Черта — порог тревоги. Мотор должен быть выше порога два клипа подряд, выстрел — один раз: его порог строже. Голоса людей тревогу не поднимают никогда.</p>
        </div>
      </section>

      {/* ---------- экран ---------- */}
      <Card className="mb-4" title="Что видит сеть: спектрограмма и волна" note="время → , частота ↑, ярче — громче; пунктир — клипы буя по 4 с; ▲ — самый резкий звук" delay={60}>
        <Scope r={r} audio={audio} head={head} />
      </Card>

      {/* ---------- ход по времени ---------- */}
      <Card className="mb-4" title="Ход по времени и решения уха буя" note="окно 4 с, шаг 0,5 с" delay={100}>
        <div className="pl-7"><Timeline r={r} /></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Мотор: гармоники и отпечаток катера" delay={140}><MotorDetail r={r} /></Card>
        <Card title="Удар: выстрел или помеха" delay={170}><ImpulseDetail r={r} /></Card>
        <Card title="Природа и тишина как улика" delay={200}><NatureDetail r={r} /></Card>
        <Card title="Признаки клипа" delay={230}><FeaturesDetail r={r} /></Card>
      </div>
    </>
  );
}
