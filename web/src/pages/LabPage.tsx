import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { State } from '../types';
import { ALERT_RU, EVENT_RU, MAX_S, VOICE, audioUrl, fmtS, labApi, num, pct0, toWav16k, type ClipRec, type LabResult, type ModelMeta, type Preset, type SceneParams } from '../lab';
import { fmtHM } from '../format';
import Scope from '../components/lab/Scope';
import Timeline, { EarChips, earChip } from '../components/lab/Timeline';
import { FeaturesDetail, ImpulseDetail, MotorDetail, NatureDetail } from '../components/lab/Details';
import ModelCard from '../components/lab/ModelCard';
import { nowAt, usePlayer, usePlayerState, type PlayerApi } from '../components/lab/player';
import { Card, Page } from './common';

/**
 * Слух буя: дайте звук — увидите и услышите, что слышит нейросеть и что решает буй.
 * Сверху — источник (сценарии одной строкой чипов, свой звук, клипы буёв), ниже — итог,
 * «слушатель» (липкая панель: звук, позиция, что сеть слышит в эту секунду; спектрограмма с перемоткой;
 * решения уха буя по клипам) и разбор по вкладкам. Здесь ничего не меняется в системе.
 */

type Group = 'threat' | 'people' | 'noise';
const PRESETS: { id: Preset; title: string; text: string; expect: string; glyph: string; group: Group; water?: boolean; air?: boolean }[] = [
  { id: 'motor-archive', group: 'threat', title: 'Катер из архива', text: 'мотор знакомого катера: под водой слышнее всего винт и выхлоп', expect: 'тревога со 2-го клипа, катер узнан', glyph: '⛵' },
  { id: 'motor-new', group: 'threat', title: 'Новый катер', text: 'мотор, которого сеть никогда не слышала', expect: 'тревога, в архиве его нет', glyph: '🚤' },
  { id: 'shot', group: 'threat', title: 'Выстрел', text: 'под водой — глухой и смазанный, иногда с ударом пули о воду', expect: 'тревога «выстрел»', glyph: '✳' },
  { id: 'silence', group: 'threat', title: 'Тишина как улика', text: 'природа живёт — и вдруг стихает', expect: 'тревога «тишина»', glyph: '◌' },
  { id: 'voices', group: 'people', title: 'Голоса', text: 'разговор в лодке: инспекторы или прохожие', expect: 'голоса, тревоги нет', glyph: '🗣' },
  { id: 'imitation', group: 'people', title: 'Выстрел голосом', text: '«пф», «бах», «тыщ», щелчок языком', expect: 'голоса, а не выстрел', glyph: '💬' },
  { id: 'mouth-motor', group: 'people', title: 'Мотор голосом', text: '«бррр», «вжжж», «тр-тр-тр» — человек изображает лодку', expect: 'голоса, а не мотор', glyph: '〜' },
  { id: 'night', group: 'noise', title: 'Тихая ночь', text: 'водные насекомые, рыбы, лягушки сверху', expect: 'тревоги нет', glyph: '☾' },
  { id: 'thunder', group: 'noise', title: 'Гром', text: 'медленный низкий раскат', expect: 'не выстрел', glyph: '⚡' },
  { id: 'wave', group: 'noise', title: 'Волна о буй', text: 'глухие удары по корпусу буя', expect: 'тревоги нет', glyph: '〰', water: true },
  { id: 'oar', group: 'noise', title: 'Весло', text: 'стук о борт — резкий, как выстрел', expect: 'не выстрел', glyph: '⌇' },
  { id: 'airplane', group: 'noise', title: 'Самолёт', text: 'гул с доплером — похож на мотор', expect: 'не мотор', glyph: '✈' },
  { id: 'fish', group: 'noise', title: 'Рыба', text: 'мягкий всплеск у поверхности', expect: 'тревоги нет', glyph: '≈' },
  { id: 'rain', group: 'noise', title: 'Дождь', text: 'шипение и щелчки капель по воде', expect: 'тревоги нет', glyph: '⁘' },
  { id: 'room', group: 'noise', title: 'Тихая комната', text: 'шум микрофона, гул сети, вентилятор, клавиатура', expect: 'фон — не голоса и не мотор', glyph: '▫', air: true },
  { id: 'claps', group: 'noise', title: 'Хлопки', text: 'ладоши, щелчки пальцами, стук по столу', expect: 'не выстрел', glyph: '✋', air: true },
];
const GROUPS: [Group, string][] = [['threat', 'Угроза'], ['people', 'Люди'], ['noise', 'Помехи']];
const EXPECT: Record<string, string | null> = { 'мотор': 'motor', 'выстрел': 'shot', 'тишина': 'silence', 'фон': null, 'фон (помеха)': null, 'голоса': null };
const EVENT_TONE: Record<string, string> = { background: 'text-primary', motor: 'text-warn', shot: 'text-alert', voice: 'text-[#7FB2E5]' };
const BAR: Record<string, string> = { background: 'bg-[var(--c-bar)]', motor: 'bg-warn', shot: 'bg-alert', voice: 'bg-[#7FB2E5]' };
const SEG_TINT: Record<string, string> = { background: 'rgb(var(--rgb-primary) / .16)', motor: 'var(--c-warn)', shot: 'var(--c-alert)', voice: VOICE };

type Tab = 'scene' | 'own' | 'buoy';
type Detail = 'time' | 'motor' | 'impulse' | 'nature' | 'features' | 'model';
const DETAILS: [Detail, string][] = [['time', 'Ход по времени'], ['motor', 'Мотор'], ['impulse', 'Удар'], ['nature', 'Природа'], ['features', 'Признаки'], ['model', 'Как училась сеть']];

function Seg<T extends string>({ value, set, items, label }: { value: T; set: (v: T) => void; items: [T, string][]; label?: string }) {
  return (
    <div className="flex w-fit max-w-full overflow-x-auto rounded-[10px] border border-line bg-bg/70 p-[3px]" role="tablist" aria-label={label}>
      {items.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => set(v)}
          className={`h-8 shrink-0 whitespace-nowrap rounded-[7px] px-3 text-[12px] font-medium ${value === v ? 'bg-primary text-bg' : 'text-muted hover:text-primary'}`}>{text}</button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, set }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; set: (v: number) => void }) {
  return (
    <label className="block min-w-[170px] flex-1">
      <div className="flex justify-between gap-3 whitespace-nowrap text-[12px]"><span className="text-muted">{label}</span><span className="font-mono">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="sky-range mt-1 w-full" />
    </label>
  );
}

const Icon = { play: <path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5z" />, pause: <><rect x="2.5" y="2" width="3" height="10" rx="1" /><rect x="8.5" y="2" width="3" height="10" rx="1" /></> };

export default function LabPage({ state }: { state: State }) {
  const [tab, setTab] = useState<Tab>('scene');
  const [p, setP] = useState<SceneParams>({ preset: 'motor-archive', vessel: 'boat-A', duration_s: 12, snr_db: 10, activity: 0.7, seed: 1, medium: 'water' });
  const [tune, setTune] = useState(false);
  const [res, setRes] = useState<LabResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<ModelMeta | null | undefined>(undefined);
  const [clips, setClips] = useState<ClipRec[] | null>(null);
  const [detail, setDetail] = useState<Detail>('time');
  const [rec, setRec] = useState<{ on: boolean; s: number; level: number }>({ on: false, s: 0, level: 0 });
  const recRef = useRef<{ stop: () => void } | null>(null);
  const player = usePlayer(res?.duration_s ?? 1, res?.id ?? '');
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

  // клавиши слушателя: пробел — пауза, ← → — на секунду; в полях ввода и на кнопках не мешаем
  useEffect(() => {
    if (!res) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' && !el?.closest('button, a, summary')) { e.preventDefault(); player.toggle(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !el?.closest('[role="tablist"]')) {
        e.preventDefault(); player.nudge(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [res, player]);

  const pick = (preset: Preset) => {
    const pr = PRESETS.find((x) => x.id === preset);
    const q: SceneParams = { ...p, preset, duration_s: preset === 'silence' ? Math.max(24, p.duration_s) : p.duration_s,
      medium: pr?.water ? 'water' : pr?.air ? 'air' : p.medium };
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
  const event = !['night', 'silence', 'rain', 'room'].includes(p.preset);
  const shown = PRESETS.filter((x) => !(x.water && p.medium === 'air') && !(x.air && p.medium === 'water'));

  return (
    <Page cap="Сеть" title="Слух буя"
      lead="Дайте звук — сценарий, свой файл, микрофон или клип с буя — и услышите, что слышит нейросеть и что решает буй. Тревоги здесь не поднимаются.">

      {/* ---------- источник звука ---------- */}
      <Card className="mb-4" title="Звук" note={<Seg label="Источник звука" value={tab} set={setTab} items={[['scene', 'Сценарий'], ['own', 'Свой звук'], ['buoy', 'С буя']]} />}>
        {tab === 'scene' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Seg label="Где микрофон" value={p.medium} set={(m) => {
                const bad = PRESETS.find((x) => x.id === p.preset && ((x.water && m === 'air') || (x.air && m === 'water')));
                const q = { ...p, medium: m, preset: bad ? (m === 'air' ? 'room' : 'night') as Preset : p.preset };
                setP(q); void runScene(q);
              }} items={[['water', 'Гидрофон под водой'], ['air', 'Микрофон в воздухе']]} />
              <span className="hidden text-[12px] leading-4 text-muted md:inline">
                {p.medium === 'water' ? 'как на буе: из воздуха звук доходит глухо, мелководье даёт отражения' : 'как при проверке микрофоном ноутбука или телефона'}
              </span>
            </div>
            <div className="space-y-2">
              {GROUPS.map(([g, label]) => (
                <div key={g} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-[.08em] text-muted sm:w-[62px] sm:pt-[7px]">{label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {shown.filter((x) => x.group === g).map((x) => (
                      <button key={x.id} type="button" onClick={() => pick(x.id)} disabled={!!busy} aria-pressed={p.preset === x.id} title={`${x.text}; ждём: ${x.expect}`}
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors disabled:opacity-60 ${p.preset === x.id ? 'border-primary bg-primary text-bg' : 'border-line hover:border-primary/40 hover:bg-white/[.04]'}`}>
                        <span aria-hidden className="text-[12px] leading-none">{x.glyph}</span>{x.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
              <p className="w-full min-w-0 text-[12px] leading-[17px] text-muted sm:w-auto sm:flex-1">
                <span className="font-medium text-primary">{cur.title}</span> — {cur.text}. <span className="text-accent">Ждём: {cur.expect}.</span> Вариант {p.seed}.
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => { const q = { ...p, seed: p.seed + 1 }; setP(q); void runScene(q); }}
                  title="Тот же сценарий, другая случайность: другие лягушки, ветер, проход катера"
                  className="ink-host h-8 rounded-[9px] border border-line px-3 text-[12px] font-semibold hover:bg-white/[.04] disabled:opacity-60">Другой вариант</button>
                <button type="button" onClick={() => setTune(!tune)} aria-expanded={tune}
                  className={`h-8 rounded-[9px] border px-3 text-[12px] font-semibold ${tune ? 'border-primary/50 bg-white/[.06]' : 'border-line hover:bg-white/[.04]'}`}>
                  Настроить <span className={`inline-block transition-transform ${tune ? 'rotate-180' : ''}`}>▾</span>
                </button>
              </div>
            </div>
            {tune && (
              <div className="enter mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
                <Slider label="Длительность" value={p.duration_s} min={p.preset === 'silence' ? 16 : 4} max={30} step={1} fmt={(v) => `${v} с`} set={(v) => setP({ ...p, duration_s: v })} />
                {event && <Slider label="Громкость над фоном" value={p.snr_db} min={-6} max={24} step={1} fmt={(v) => `${v > 0 ? '+' : ''}${v} дБ`} set={(v) => setP({ ...p, snr_db: v })} />}
                <Slider label={p.preset === 'silence' ? 'Живость до тишины' : 'Живость природы'} value={p.activity} min={0} max={1} step={0.05} fmt={(v) => num(v, 2)} set={(v) => setP({ ...p, activity: v })} />
                {p.preset === 'motor-archive' && (
                  <div>
                    <div className="mb-1 text-[12px] text-muted">Катер</div>
                    <Seg label="Катер" value={p.vessel} set={(v) => setP({ ...p, vessel: v })} items={[['boat-A', 'boat-A'], ['boat-B', 'boat-B'], ['boat-C', 'boat-C']]} />
                  </div>
                )}
                <button type="button" disabled={!!busy} onClick={() => runScene(p)}
                  className="btn-shine ink-host h-9 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-bg hover:bg-white disabled:opacity-60">Разобрать</button>
              </div>
            )}
          </>
        )}

        {tab === 'own' && (
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void runBlob(f, f.name); }}
              className="grid min-h-[112px] cursor-pointer place-items-center rounded-[12px] border border-dashed border-line px-4 text-center hover:border-primary/40 hover:bg-white/[.02]">
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void runBlob(f, f.name); e.target.value = ''; }} />
              <span>
                <span className="block text-[14px] font-medium">Перетащите звук сюда или нажмите</span>
                <span className="mt-1 block text-[12px] text-muted">WAV, MP3, OGG, M4A — до {MAX_S} с; приводится к 16 кГц моно, как у буя</span>
              </span>
            </label>
            <div className="flex flex-col justify-between rounded-[12px] border border-line p-4">
              <div>
                <div className="text-[14px] font-medium">Запись с микрофона</div>
                <div className="mt-1 text-[12px] leading-4 text-muted">До 20 с: тишина в комнате, хлопок, «пф», «бррр», видео с мотором лодки.</div>
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

        {busy && (
          <div className="mt-3 flex items-center gap-3 text-[13px] text-muted" role="status">
            <span className="flex h-4 items-end gap-[3px]" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} className="lab-bar w-[3px] rounded-full bg-accent" style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
            {busy}
          </div>
        )}
      </Card>

      {err && <div role="alert" className="enter mb-4 rounded-[12px] border border-warn/50 bg-warn/10 px-4 py-2.5 text-[13px]">{err}</div>}
      {meta === null && <div role="alert" className="mb-4 rounded-[12px] border border-alert/50 bg-alert/10 px-4 py-2.5 text-[13px]">Нейросеть не обучена на этом сервере: запустите <span className="font-mono">tools/ml/train.py</span>.</div>}

      {res && <Result key={res.id} r={res} player={player} dim={!!busy} meta={meta ?? null} detail={detail} setDetail={setDetail} />}
      {!res && meta && <Card className="mt-4" title="Как училась сеть и насколько ей верить" note={`модель ${meta.version}`}><ModelCard meta={meta} /></Card>}
    </Page>
  );
}

/** Звук целиком в память браузера: по blob-адресу перемотка работает всегда (сервер отдаёт WAV без Range). */
function useBlobSrc(remote: string) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url = '', dead = false;
    fetch(remote).then((x) => (x.ok ? x.blob() : Promise.reject(new Error(String(x.status)))))
      .then((blob) => { if (!dead) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => { if (!dead) setSrc(remote); });
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [remote]);
  return src;
}

function Listener({ r, player }: { r: LabResult; player: PlayerApi }) {
  const { playing, t, rate, loop } = usePlayerState(player);    // только панель живёт с временем
  const now = nowAt(r, t);
  const ch = earChip(now.clip);
  const dur = r.duration_s;
  const src = useBlobSrc(r.source === 'buoy' && r.sha256 ? `/api/clips/${r.sha256}/audio` : audioUrl(r));
  return (
    <div className="sticky top-2 z-30 mb-3 rounded-[14px] border border-line px-3 py-2.5 shadow-[0_14px_40px_-22px_rgba(0,0,0,.9)] md:px-4"
      style={{ background: 'linear-gradient(var(--c-card), var(--c-card)), rgb(var(--rgb-bg))' }}>
      <audio ref={player.audio} src={src} preload="auto" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
        <button type="button" onClick={player.toggle} aria-label={playing ? 'Пауза (пробел)' : 'Слушать (пробел)'}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-bg hover:bg-white">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">{playing ? Icon.pause : Icon.play}</svg>
        </button>
        <div className="whitespace-nowrap font-mono text-[13px] tabular-nums">{fmtS(t)}<span className="text-muted"> / {fmtS(dur)}</span></div>
        {/* дорожка: клипы буя цветом того, что услышала сеть; клик — слушать отсюда */}
        <div className="relative order-last h-6 w-full cursor-pointer md:order-none md:w-auto md:flex-1" role="slider" aria-label="Позиция звука" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); player.nudge(e.key === 'ArrowLeft' ? -1 : 1); } }}
          onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); player.seek(((e.clientX - b.left) / b.width) * dur); player.play(); }}>
          <div className="absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2 gap-[2px] overflow-hidden rounded-full">
            {r.clips.map((c) => (
              <span key={c.i} className="h-full" title={`Клип ${c.i}: ${EVENT_RU[c.event]}`}
                style={{ width: `${((c.end - c.start) / dur) * 100}%`, background: c.alert ? 'var(--c-alert)' : SEG_TINT[c.event], opacity: c.alert ? 0.95 : c.event === 'background' ? 1 : 0.55 }} />
            ))}
          </div>
          <div ref={player.bind} className="pointer-events-none absolute inset-y-0 left-0 will-change-transform" style={{ opacity: 0 }}>
            <span className="absolute -left-[7px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 rounded-full border-2 border-[var(--c-card)] bg-primary shadow" />
          </div>
        </div>
        {/* что сеть слышит сейчас */}
        <div className="flex min-w-0 items-center gap-2 text-[12px]" aria-live="off">
          <span className="hidden text-muted sm:inline">сейчас</span>
          <span className={`font-semibold ${EVENT_TONE[now.ev]}`}>{EVENT_RU[now.ev]} {pct0(now.p)}</span>
          <span className={`hidden truncate rounded-[6px] border px-1.5 leading-[20px] sm:inline ${ch.cls}`}>клип {now.clip.i}: {ch.text}</span>
          {now.unfamiliar && <span className="rounded-[6px] border border-dashed border-warn/70 px-1.5 leading-[20px] text-warn">непривычно</span>}
        </div>
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {[0.5, 1].map((v) => (
            <button key={v} type="button" onClick={() => player.setRate(v)} aria-pressed={rate === v} title={v < 1 ? 'Вдвое медленнее — удобно слушать удары и щелчки' : 'Обычная скорость'}
              className={`h-7 rounded-[7px] px-1.5 font-mono text-[11px] sm:px-2 ${rate === v ? 'bg-white/[.1] text-primary' : 'text-muted hover:text-primary'}`}>{v === 1 ? '1×' : '½×'}</button>
          ))}
          <button type="button" onClick={() => player.setLoop(!loop)} aria-pressed={loop} title="По кругу"
            className={`grid h-7 w-7 place-items-center rounded-[7px] ${loop ? 'bg-white/[.1] text-primary' : 'text-muted hover:text-primary'}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5a4 4 0 0 1 7.2-2.4L11 5.5M11 2.5v3H8M11.5 7.5a4 4 0 0 1-7.2 2.4L3 8.5M3 11.5v-3h3" /></svg>
          </button>
          <span className="ml-2 hidden items-center gap-1 text-[10px] text-muted xl:flex" aria-hidden>
            <kbd className="rounded-[4px] border border-line px-1.5 font-sans leading-[16px]">пробел</kbd>
            <kbd className="rounded-[4px] border border-line px-1 font-sans leading-[16px]">←</kbd><kbd className="rounded-[4px] border border-line px-1 font-sans leading-[16px]">→</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}

function Result({ r, player, dim, meta, detail, setDetail }: {
  r: LabResult; player: PlayerApi; dim: boolean; meta: ModelMeta | null; detail: Detail; setDetail: (d: Detail) => void;
}) {
  const main = r.clips.find((c) => c.i === r.main_clip)!;
  const want = r.truth != null ? EXPECT[r.truth] : undefined;
  const got = r.verdict.alerts.map((a) => a.kind);
  const right = want === undefined ? null : want === null ? got.length === 0 : got.includes(want as never);
  const alertLine: ReactNode = got.length
    ? <>Буй поднял бы тревогу: {r.verdict.alerts.map((a, i) => <b key={i} className="text-alert">{i ? ', ' : ''}{ALERT_RU[a.kind]} (клип {a.clip}, {pct0(a.confidence)})</b>)}.</>
    : <>Тревоги нет: {main.note}.</>;
  const tabs = DETAILS.filter(([d]) => d !== 'model' || meta);

  return (
    <div className={`transition-opacity duration-300 ${dim ? 'opacity-50' : ''}`}>
      {/* ---------- итог ---------- */}
      <section className="card enter mb-4 grid gap-4 lg:grid-cols-[1.3fr_1fr] lg:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span className="cap">{r.source === 'scene' ? 'сценарий' : r.source === 'buoy' ? 'клип буя' : 'ваш звук'}</span>
            <span>{r.title}{r.vessel ? ` · ${r.vessel}` : ''}{r.medium ? ` · ${r.medium === 'water' ? 'под водой' : 'в воздухе'}` : ''} · {num(r.duration_s, 1)} с</span>
            {r.truth && <span className="rounded-[6px] border border-line px-1.5">в звуке: {r.truth}</span>}
          </div>
          <div className={`mt-2 text-[30px] font-semibold leading-[36px] tracking-[-.015em] md:text-[34px] md:leading-[40px] ${EVENT_TONE[main.event]}`}>
            {EVENT_RU[main.event]} <span className="font-light">· {pct0(main.confidence)}</span>
          </div>
          <p className="mt-1.5 text-[14px] leading-[21px]">{alertLine}</p>
          {right != null && (
            <p className={`mt-1.5 text-[13px] font-medium ${right ? 'text-accent' : 'text-alert'}`}>
              {right ? (want ? '✓ Совпадает с тем, что на самом деле в звуке.'
                : r.truth === 'голоса' ? (r.clips.some((c) => c.event === 'voice') ? '✓ Сеть узнала голоса людей и тревогу не подняла.' : '✓ Тревоги нет, хотя голоса сеть не выделила.')
                  : '✓ Помеха не обманула сеть — ложной тревоги нет.')
                : `✗ Сеть ошиблась: в звуке ${r.truth}, а ${got.length ? `тревога «${got.map((g) => ALERT_RU[g]).join(', ')}»` : 'тревоги нет'}.`}
            </p>
          )}
          {r.verdict.unfamiliar && (
            <p className="mt-2 rounded-[10px] border border-dashed border-warn/60 bg-warn/[.07] px-3 py-2 text-[13px] leading-[19px]">
              <b className="text-warn">Непривычный звук</b> (до {num(Math.max(...r.clips.map((c) => c.novelty ?? 0)), 1)} при пороге 1): на таком сеть не училась, поэтому тревогу «мотор» или «выстрел» по нему буй не поднимает.
            </p>
          )}
        </div>
        <div>
          <div className="mb-2 text-[12px] text-muted">Клип {main.i} ({fmtS(main.start)}–{fmtS(main.end)}): ответ сети и пороги тревоги</div>
          <ul className="space-y-2.5">
            {r.classes.map((c) => {
              const v = main.probs[c];
              const thr = c === 'motor' ? r.thresholds.motor : c === 'shot' ? r.thresholds.shot : null;
              return (
                <li key={c}>
                  <div className="flex justify-between text-[13px]"><span className={c === main.event ? 'font-semibold' : ''}>{EVENT_RU[c]}</span><span className="font-mono">{num(v * 100, 1)} %</span></div>
                  <div className="relative mt-1 h-2 rounded-full bg-white/[.06]">
                    <div className={`bar-grow-x h-full rounded-full ${BAR[c]}`} style={{ width: `${Math.max(1, v * 100)}%` }} />
                    {thr != null && <span className="absolute -inset-y-1 w-[2px] rounded bg-primary" style={{ left: `${thr * 100}%` }} title={`порог ${num(thr * 100, 1)} %`} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-[15px] text-muted">Черта — порог тревоги: мотору нужно два клипа подряд выше него, выстрелу — один. Голоса тревогу не поднимают.</p>
        </div>
      </section>

      {/* ---------- слушатель: липкая панель + спектрограмма + решения уха; дальше разбор ---------- */}
      <div>
        <Listener r={r} player={player} />
        <Card className="mb-4" title="Что слышит сеть" note="время →, частота ↑, ярче — громче · пунктир — клипы буя по 4 с · ▲ — самый резкий звук" delay={60}>
          <Scope r={r} player={player} />
          <div className="mt-2 pl-[54px]"><EarChips r={r} player={player} /></div>
          <p className="mt-2 pl-[54px] text-[11px] leading-[15px] text-muted">Решения уха буя по клипам — нажмите, чтобы послушать клип. По спектрограмме можно водить, не отпуская.</p>
        </Card>

        <section className="card enter" style={{ animationDelay: '100ms' }}>
          <div className="mb-4 overflow-x-auto"><Seg label="Разбор" value={detail} set={setDetail} items={tabs} /></div>
          {detail === 'time' && <div className="pl-7"><Timeline r={r} player={player} /></div>}
          {detail === 'motor' && <MotorDetail r={r} />}
          {detail === 'impulse' && <ImpulseDetail r={r} />}
          {detail === 'nature' && <NatureDetail r={r} />}
          {detail === 'features' && <FeaturesDetail r={r} />}
          {detail === 'model' && meta && <ModelCard meta={meta} />}
        </section>
      </div>
    </div>
  );
}
