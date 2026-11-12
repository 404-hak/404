import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SeaSound } from '../introSound';
import { useSoundOn } from '../sound';
import Reeds from './Reeds';
import { currentTheme } from '../theme';

/**
 * Интро: ночное море дельты, камера наводит резкость, знак падает, как поплавок, — смаз движения,
 * бульк, брызги штрихами, круги и пузыри; игла уходит под воду, щит покачивается и отражается;
 * буй подаёт сигнал, из размытия проявляется «404 · Браконьер не найден», сцена растворяется в дашборде.
 * Стартует сам. Звук — если браузер разрешит; иначе по первому касанию (кнопка «Включить звук»).
 */

const W = 1600, H = 900, HORIZON = 470, WATER = 610, CX = 800, MOON = { x: 1235, y: 165 };
const MARK_RATIO = 819.83 / 1250;        // ширина / высота знака (brand/src/mark-data.mjs)
const MH = 210, MW = MH * MARK_RATIO;
const SETTLED = WATER - 0.8 * MH;         // в покое над водой щит и крылья, игла — под водой
const START = -MH - 60, IMPACT = WATER - MH;
const T_IN = 1.1, T_DROP = 0.7, FALL = 0.8, T_HIT = T_DROP + FALL;
const T_PING = 2.8, T_WORD = 3.2, T_TAG = 3.8, T_OUT = 5.8, OUT = 0.9;
/** Ночь — луна и звёзды; день — солнце, голубая вода, тёмный знак (инверсная версия бренда) */
const NIGHT = {
  primary: '#E2E8F0', accent: '#7A866F', muted: '#A2A9B4', moon: '#E8EDF4', ink: '#E2E8F0',
  sky: ['#060D1A', '#0B1628', '#1C3050'], sea: ['#1C3050', '#0F1E36', '#050C17'], island: '#0A1424',
  glow: 0.4, glint: 1, stars: true, vignette: 0.55, reedMid: '#07101F', reedNear: '#02060D', fade: '7, 15, 29',
  mark: '/brand/404-logo-cream.svg', word: '/brand/404-wordmark-cream.svg', crescent: true,
};
const DAY = {
  primary: '#FFFFFF', accent: '#5E6A57', muted: '#505968', moon: '#FFF8E6', ink: '#0B1628',
  sky: ['#5D86B4', '#93B5D4', '#DDE8F1'], sea: ['#CADBE8', '#86A8C4', '#2D5070'], island: '#6B8173',
  glow: 0.75, glint: 1.35, stars: false, vignette: 0.22, reedMid: '#4A5A42', reedNear: '#25311F', fade: '226, 232, 240',
  mark: '/brand/404-logo-dark.svg', word: '/brand/404-wordmark-dark.svg', crescent: false,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Затухающие колебания поплавка после удара о воду */
function bobTop(tau: number) {
  const w = 7, z = 0.32, wd = w * Math.sqrt(1 - z * z);
  const x0 = IMPACT - SETTLED, v0 = 520;
  return SETTLED + Math.exp(-z * w * tau) * (x0 * Math.cos(wd * tau) + ((v0 + z * w * x0) / wd) * Math.sin(wd * tau));
}
function markTop(t: number) {
  if (t < T_HIT) return START + (IMPACT - START) * ((t - T_DROP) / FALL) ** 2;
  const tau = t - T_HIT;
  return bobTop(tau) + 3 * Math.sin(1.6 * t) * (1 - Math.exp(-tau));
}
function markTilt(t: number) {
  if (t < T_HIT) return 5 * Math.sin((t - T_DROP) * 4);
  const tau = t - T_HIT;
  return 7 * Math.exp(-1.4 * tau) * Math.sin(6 * tau) + 1.2 * Math.sin(1.3 * t);
}

/** ?introAt=3.5 — стоп-кадр интро на нужной секунде (скриншоты для слайдов) */
function frozenAt(): number | null {
  try {
    const v = new URLSearchParams(location.search).get('introAt');
    return v != null && v !== '' && !Number.isNaN(+v) ? +v : null;
  } catch {
    return null;
  }
}

function useScene() {
  return useMemo(() => {
    const r = rng(404);
    const stars = Array.from({ length: 80 }, () => ({ x: r() * W, y: r() * (HORIZON - 40), s: 0.5 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 1.6 }));
    const glints = Array.from({ length: 52 }, () => ({ y: HORIZON + 6 + r() ** 1.6 * (H - HORIZON), ph: r() * 6.28, sp: 1 + r() * 2.5, j: r() }));
    const streaks = Array.from({ length: 30 }, () => ({ x: r() * W, y: HORIZON + 8 + r() ** 1.3 * (H - HORIZON), l: 30 + r() * 130, sp: 4 + r() * 10, o: 0.03 + r() * 0.07 }));
    const drops = Array.from({ length: 26 }, () => {
      const a = (25 + r() * 130) * (Math.PI / 180);
      return { vx: Math.cos(a) * (180 + r() * 380), vy: -Math.sin(a) * (300 + r() * 440), r: 1.4 + r() * 2.8 };
    });
    const bubbles = Array.from({ length: 9 }, (_, i) => ({ t: T_HIT + 0.15 + i * 0.14 + r() * 0.12, dx: (r() - 0.5) * MW * 0.9, f: 600 + r() * 500 }));
    const shore = (x0: number, x1: number) => {
      let d = `M${x0},${HORIZON + 2}`;
      for (let x = x0; x <= x1; x += 18) d += ` L${x},${HORIZON - 3 - r() * 9 - (r() < 0.12 ? 7 : 0)}`;
      return d + ` L${x1},${HORIZON + 2} Z`;
    };
    const islands = [shore(-20, 560), shore(1060, 1300), shore(1380, 1620)];
    return { stars, glints, streaks, drops, bubbles, islands };
  }, []);
}

export default function Intro({ onDone }: { onDone: () => void }) {
  const scene = useScene();
  const soundOn = useSoundOn();
  const [C] = useState(() => (currentTheme() === 'day' ? DAY : NIGHT));   // тема на момент показа
  const [t, setT] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const born = useRef(performance.now());
  const sound = useRef<SeaSound | null>(null);
  const scheduled = useRef(false);
  const done = useRef(false);

  const freeze = useRef(frozenAt());
  const now = () => freeze.current ?? (performance.now() - born.current) / 1000;

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    sound.current?.fadeOut(0.6);
    window.setTimeout(onDone, 50);
  }, [onDone]);

  const skip = () => {
    // «Пропустить» — сразу к растворению сцены
    if (now() < T_OUT) born.current = performance.now() - T_OUT * 1000;
  };

  // анимация
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const tt = now();
      setT(tt);
      if (tt >= T_OUT + OUT && freeze.current == null) finish();
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [finish]); // eslint-disable-line react-hooks/exhaustive-deps

  // звук: пробуем сразу; если браузер не разрешил — по первому касанию, с текущего момента сцены
  useEffect(() => {
    if (!soundOn || freeze.current != null) return;
    let s: SeaSound;
    try { s = new SeaSound(); } catch { return; }
    sound.current = s;
    const schedule = () => {
      if (scheduled.current || done.current) return;
      scheduled.current = true;
      setNeedsTap(false);
      const at = now();
      const ev = (time: number, fn: (when: number) => void) => { if (time >= at - 0.05) fn(s.at(Math.max(0, time - at))); };
      s.startWaves();
      if (at < T_HIT) ev(T_DROP + 0.05, (w) => s.whoosh(w, Math.max(0.1, T_HIT - Math.max(at, T_DROP + 0.05))));
      ev(T_HIT, (w) => s.plop(w));
      scene.bubbles.forEach((b) => ev(b.t, (w) => s.bubble(w, b.f)));
      ev(T_PING, (w) => s.ping(w));
    };
    void s.resume().then((ok) => { if (ok) schedule(); else if (!done.current) setNeedsTap(true); });
    const unlock = () => { void s.resume().then((ok) => ok && schedule()); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [soundOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- кадр ----------
  const T = t;                                   // время сцены
  const fallen = t >= T_DROP;
  const tau = t - T_HIT;
  const top = fallen ? markTop(t) : START;
  const tilt = fallen ? markTilt(t) : 0;
  // смаз движения: при падении — по скорости, после удара — по скорости покачивания
  const vy = t < T_HIT ? (2 * (IMPACT - START) * ((t - T_DROP) / FALL)) / FALL : Math.abs(markTop(t + 0.01) - markTop(t)) * 100;
  const motionBlur = fallen ? Math.min(11, vy * 0.0068) : 0;

  // камера: наводка резкости в начале, растворение в конце
  const inK = easeOut(t / T_IN), outK = ease((t - T_OUT) / OUT);
  const camBlur = 16 * (1 - inK) + 18 * outK;
  const camScale = 1.04 - 0.04 * inK + 0.05 * outK;
  const camOpacity = inK * (1 - outK);

  const markG = (
    <g transform={`rotate(${tilt} ${CX} ${WATER}) translate(${CX - MW / 2} ${top})`}>
      <image href={C.mark} width={MW} height={MH} />
    </g>
  );
  const wordK = ease((t - T_WORD) / 1.0), tagK = ease((t - T_TAG) / 0.9);

  return (
    <div role="dialog" aria-label="Заставка 404" className="fixed inset-0 z-[3000] overflow-hidden"
      style={{ background: `rgba(${C.fade}, ${1 - outK})` }}>
      <div className="absolute inset-0" style={{ filter: camBlur > 0.2 ? `blur(${camBlur}px)` : undefined, transform: `scale(${camScale})`, opacity: camOpacity }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="i-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.sky[0]} />
              <stop offset="0.7" stopColor={C.sky[1]} />
              <stop offset="1" stopColor={C.sky[2]} />
            </linearGradient>
            <linearGradient id="i-sea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.sea[0]} />
              <stop offset="0.2" stopColor={C.sea[1]} />
              <stop offset="1" stopColor={C.sea[2]} />
            </linearGradient>
            <radialGradient id="i-moonGlow">
              <stop offset="0" stopColor={C.moon} stopOpacity={C.glow} />
              <stop offset="0.35" stopColor={C.moon} stopOpacity="0.1" />
              <stop offset="1" stopColor={C.moon} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="i-haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.primary} stopOpacity="0" />
              <stop offset="0.5" stopColor={C.primary} stopOpacity="0.08" />
              <stop offset="1" stopColor={C.primary} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="i-mist">
              <stop offset="0" stopColor={C.primary} stopOpacity="0.09" />
              <stop offset="1" stopColor={C.primary} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="i-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.primary} stopOpacity="0" />
              <stop offset="0.5" stopColor={C.primary} stopOpacity="1" />
              <stop offset="1" stopColor={C.primary} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="i-vignette" cx="50%" cy="48%" r="75%">
              <stop offset="0.55" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity={C.vignette} />
            </radialGradient>
            <linearGradient id="i-reflFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="i-reflMask" maskUnits="userSpaceOnUse">
              <rect x="0" y={WATER} width={W} height={MH * 0.9} fill="url(#i-reflFade)" />
            </mask>
            <clipPath id="i-above"><rect x="0" y="0" width={W} height={WATER + 1} /></clipPath>
            <clipPath id="i-below"><rect x="0" y={WATER} width={W} height={H - WATER} /></clipPath>
            <filter id="i-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="i-far" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="1.4" /></filter>
            <filter id="i-soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="0.7" /></filter>
            <filter id="i-motion" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={`${motionBlur * 0.15} ${motionBlur}`} /></filter>
            <filter id="i-word" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation={12 * (1 - wordK)} /></filter>
            <filter id="i-tag" x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation={8 * (1 - tagK)} /></filter>
          </defs>

          {/* небо: звёзды, луна с ореолом */}
          <rect width={W} height={HORIZON} fill="url(#i-sky)" />
          {C.stars && scene.stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.s} fill={C.primary} opacity={0.2 + 0.55 * (0.5 + 0.5 * Math.sin(T * s.sp + s.ph))} />
          ))}
          <circle cx={MOON.x} cy={MOON.y} r="190" fill="url(#i-moonGlow)" />
          <g filter="url(#i-glow)">
            <circle cx={MOON.x} cy={MOON.y} r="30" fill={C.moon} />
            {C.crescent && <circle cx={MOON.x + 12} cy={MOON.y - 7} r="27" fill="#0B1628" opacity="0.16" />}
          </g>

          {/* море: градиент, зыбь катится к зрителю, мазки света, лунная дорожка */}
          <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#i-sea)" />
          {Array.from({ length: 11 }, (_, i) => {
            const p = ((i / 11 + T * 0.03) % 1);
            const k = p ** 1.9;
            const y = HORIZON + (H - HORIZON) * k;
            const h = 2 + 46 * k;
            return <rect key={`sw${i}`} x="0" y={y - h / 2} width={W} height={h} fill="url(#i-band)" opacity={0.045 * Math.sin(Math.PI * p)} />;
          })}
          <g filter="url(#i-soft)">
            {scene.streaks.map((s, i) => {
              const x = ((s.x + T * s.sp) % (W + 200)) - 100;
              const k = (s.y - HORIZON) / (H - HORIZON);
              return <rect key={i} x={x} y={s.y} width={s.l * (0.4 + k)} height={1 + k * 1.4} rx="1" fill={C.primary} opacity={s.o} />;
            })}
          </g>
          <g filter="url(#i-glow)">
            {scene.glints.map((g, i) => {
              const k = (g.y - HORIZON) / (H - HORIZON);
              const len = 6 + k * 95 * (0.4 + g.j);
              const x = MOON.x + Math.sin(T * 0.7 + g.ph) * (4 + k * 44) - len / 2;
              return <rect key={i} x={x} y={g.y} width={len} height={1 + k * 2.2} rx="1" fill={C.moon}
                opacity={Math.min(1, (0.12 + 0.5 * (0.5 + 0.5 * Math.sin(T * g.sp + g.ph))) * (1 - k * 0.5) * C.glint)} />;
            })}
          </g>

          {/* горизонт: дымка, дальние острова (не в фокусе), туман над водой */}
          <rect y={HORIZON - 45} width={W} height="100" fill="url(#i-haze)" />
          <g filter="url(#i-far)">{scene.islands.map((d, i) => <path key={`is${i}`} d={d} fill={C.island} opacity="0.92" />)}</g>
          <ellipse cx={500 + Math.sin(T * 0.12) * 120} cy={HORIZON + 22} rx="520" ry="34" fill="url(#i-mist)" />
          <ellipse cx={1150 - Math.sin(T * 0.1 + 1) * 140} cy={HORIZON + 48} rx="460" ry="30" fill="url(#i-mist)" />

          {/* круги от падения и сигнал буя */}
          {tau > 0 && [0, 0.22, 0.44].map((d, k) => {
            const a = tau - d;
            if (a <= 0) return null;
            const rx = MW * 0.5 + 250 * a;
            return <ellipse key={`r${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.ink} strokeWidth="1.5" opacity={Math.max(0, 0.55 * (1 - a / 2.4))} />;
          })}
          <g filter="url(#i-glow)">
            {[0, 0.45].map((d, k) => {
              const a = t - T_PING - d;
              if (a <= 0 || a > 2.2) return null;
              const rx = MW * 0.45 + 420 * a;
              return <ellipse key={`p${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.accent} strokeWidth="2.5" opacity={Math.max(0, 0.9 * (1 - a / 2.0))} />;
            })}
          </g>

          {/* отражение щита, поплавок со смазом движения */}
          {fallen && tau > -0.05 && (
            <g clipPath="url(#i-below)" mask="url(#i-reflMask)" opacity="0.24" filter="url(#i-soft)">
              <g transform={`translate(${CX} ${WATER}) skewX(${Math.sin(T * 2.2) * 4}) translate(${-CX} ${-WATER}) translate(0 ${2 * WATER}) scale(1 -1)`}>
                {markG}
              </g>
            </g>
          )}
          {fallen && (
            <g filter={motionBlur > 0.3 ? 'url(#i-motion)' : undefined}>
              <g clipPath="url(#i-below)" opacity="0.13">{markG}</g>
              <g clipPath="url(#i-above)">{markG}</g>
            </g>
          )}
          {tau > 0 && (
            <path d={`M${CX - MW * 0.7},${WATER + 3 * Math.sin(T * 1.3)} Q${CX},${WATER + 5} ${CX + MW * 0.7},${WATER + 3 * Math.sin(T * 1.3 + 1)}`}
              fill="none" stroke={C.ink} strokeWidth="1.5" opacity={0.35} filter="url(#i-soft)" />
          )}

          {/* пена, брызги штрихами по траектории, пузыри */}
          {tau > 0 && tau < 0.7 && (
            <ellipse cx={CX} cy={WATER} rx={MW * (0.6 + tau * 1.2)} ry={9 + tau * 6} fill={C.primary} opacity={0.4 * (1 - tau / 0.7)} filter="url(#i-soft)" />
          )}
          {tau > 0 && tau < 1.3 && scene.drops.map((d, i) => {
            const x = CX + d.vx * tau;
            const vy2 = d.vy + 1500 * tau;
            const y = WATER - 12 + d.vy * tau + 0.5 * 1500 * tau * tau;
            if (y > WATER + 2) return null;
            const sp = Math.hypot(d.vx, vy2);
            const ang = (Math.atan2(vy2, d.vx) * 180) / Math.PI;
            return <ellipse key={`d${i}`} cx={x} cy={y} rx={d.r * (1 + sp * 0.006)} ry={d.r * 0.7}
              transform={`rotate(${ang} ${x} ${y})`} fill={C.primary} opacity={Math.max(0, 0.95 - tau / 1.25)} />;
          })}
          {scene.bubbles.map((b, i) => {
            const a = t - b.t;
            if (a < 0 || a > 0.45) return null;
            return <circle key={`b${i}`} cx={CX + b.dx} cy={WATER - 2 - a * 6} r={2 + a * 12} fill="none" stroke={C.primary} strokeWidth="1.2" opacity={0.7 * (1 - a / 0.45)} />;
          })}

          {/* название проявляется из размытия */}
          {t >= T_WORD && (
            <g opacity={wordK} transform={`translate(0 ${(1 - wordK) * 16})`} filter={wordK < 0.99 ? 'url(#i-word)' : undefined}>
              <image href={C.word} x={CX - 190} y={168} width={380} height={380 / 4.09} />
            </g>
          )}
          {t >= T_TAG && (
            <text x={CX} y={318} textAnchor="middle" fill={C.muted} fontFamily="Inter, sans-serif" fontSize="20" fontWeight="600"
              letterSpacing={6 + 8 * (1 - tagK)} opacity={tagK} filter={tagK < 0.99 ? 'url(#i-tag)' : undefined}>
              БРАКОНЬЕР НЕ НАЙДЕН
            </text>
          )}
          <rect width={W} height={H} fill="url(#i-vignette)" />
        </svg>

        {/* камыш: средний план чуть мягче, передний — сильно размыт (глубина резкости) */}
        <Reeds side="left" seed={11} count={12} className="absolute bottom-[-2vh] left-[4vw] h-[46vh] w-auto" style={{ filter: 'blur(1.2px)', color: C.reedMid }} />
        <Reeds side="right" seed={23} count={12} className="absolute bottom-[-2vh] right-[4vw] h-[42vh] w-auto" style={{ filter: 'blur(1.2px)', color: C.reedMid }} />
        <Reeds side="left" seed={5} count={14} className="absolute bottom-[-8vh] left-[-6vw] h-[82vh] w-auto" style={{ filter: 'blur(7px)', color: C.reedNear }} />
        <Reeds side="right" seed={17} count={14} className="absolute bottom-[-8vh] right-[-6vw] h-[78vh] w-auto" style={{ filter: 'blur(7px)', color: C.reedNear }} />
      </div>

      <div className="absolute right-4 top-4 flex items-center gap-2" style={{ opacity: 1 - outK }}>
        {needsTap && soundOn && (
          <button type="button" className="flex items-center gap-1.5 rounded-chip border border-accent/60 bg-accent/15 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-accent/30">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 8v4h3l4 3.5v-11L6 8H3z" /><path d="M13.5 7a4 4 0 0 1 0 6M15.6 5a7 7 0 0 1 0 10" />
            </svg>
            Включить звук
          </button>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); skip(); }}
          className="rounded-chip border border-line bg-bg/40 px-3 py-1.5 text-[12px] text-muted backdrop-blur hover:text-primary">
          Пропустить
        </button>
      </div>
    </div>
  );
}
