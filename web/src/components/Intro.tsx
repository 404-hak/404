import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SeaSound } from '../introSound';
import { useSoundOn } from '../sound';
import Reeds from './Reeds';
import { currentSky, type Sky } from '../theme';
import { hex, palAt, type V3 } from '../skyPalette';

/**
 * Интро: ночное море дельты, камера наводит резкость, знак падает, как поплавок, — смаз движения,
 * бульк, брызги штрихами, круги и пузыри; игла уходит под воду, щит покачивается и отражается;
 * буй подаёт сигнал, из размытия проявляется «404 · Браконьер не найден», сцена растворяется в дашборде.
 * Стартует сам. Звук — если браузер разрешит; иначе по первому касанию (кнопка «Включить звук»).
 */

const W = 1600, H = 900, HORIZON = 470, WATER = 610, CX = 800;
const MARK_RATIO = 819.83 / 1250;        // ширина / высота знака (brand/src/mark-data.mjs)
const MH = 210, MW = MH * MARK_RATIO;
const SETTLED = WATER - 0.8 * MH;         // в покое над водой щит и крылья, игла — под водой
const START = -MH - 60, IMPACT = WATER - MH;
const T_IN = 1.1, T_DROP = 0.7, FALL = 0.8, T_HIT = T_DROP + FALL;
const T_PING = 2.8, T_WORD = 3.2, T_TAG = 3.8, T_OUT = 5.8, OUT = 0.9;
/** Палитра интро из настоящего неба темы: в «Авто» — время суток по МСК, солнце или луна на своих местах */
const css = (c: V3) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;
const mixV = (a: V3, b: V3, k: number) => a.map((v, i) => v + (b[i] - v) * k) as V3;
/** Светило не прячем за надписью «404»: в интро сдвигаем его за край названия (в фоне — точное место) */
const clearOfTitle = (x: number, y: number) => (y < 360 && Math.abs(x - CX) < 290 ? CX + (x >= CX ? 1 : -1) * 290 : x);

function buildPalette(sky: Sky) {
  const p = palAt(sky.sunAlt);
  const light = sky.ui >= 0.5;
  const useSun = sky.sun.visible >= sky.moon.visible && sky.sun.visible > 0.2;
  const b = useSun ? sky.sun : sky.moon;
  const seen = useSun ? sky.sun.visible : sky.moon.visible;
  const skyBands = [0, 1, 2, 3].map((i) => css(mixV(p.hz, p.top, i / 3)));
  const by = HORIZON - 34 - Math.min(1, Math.max(0, (b.y - 0.812) / 0.115)) * (HORIZON - 130);
  const band = skyBands[Math.min(3, Math.floor(((HORIZON - by) / HORIZON) * 4))];
  return {
    light, skyBands, band,
    seaBands: [0, 1, 2, 3].map((i) => css(mixV(p.far, p.near, i / 3))),
    line: css(p.line), island: css(p.isle), stars: p.stars, horizon: css(mixV(p.hz, [1, 1, 1], 0.35)),
    body: seen > 0.15 ? { x: clearOfTitle(140 + b.x * (W - 280), by), y: by, sun: useSun, illum: sky.moon.illum >= 0 ? sky.moon.illum : 0.75, waxing: sky.moon.waxing } : null,
    bodyC: useSun ? css(p.sun) : '#F1F4FA',
    primary: '#FFFFFF', accent: light ? '#5E6A57' : '#8E9C80', muted: light ? '#505968' : '#B4BAC4',
    vignette: 0.12 + 0.4 * (1 - sky.day),
    reedMid: css(mixV(hex('#07101F'), hex('#4A5A42'), sky.day)), reedNear: css(mixV(hex('#02060D'), hex('#25311F'), sky.day)),
    fade: getComputedStyle(document.documentElement).getPropertyValue('--rgb-bg').trim() || '11 22 40',
    mark: light ? '/brand/404-logo-dark.svg' : '/brand/404-logo-cream.svg',
    word: light ? '/brand/404-wordmark-dark.svg' : '/brand/404-wordmark-cream.svg',
  };
}

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
  const [C] = useState(() => buildPalette(currentSky()));   // небо на момент показа
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
      style={{ background: `rgb(${C.fade} / ${1 - outK})` }}>
      <div className="absolute inset-0" style={{ filter: camBlur > 0.2 ? `blur(${camBlur}px)` : undefined, transform: `scale(${camScale})`, opacity: camOpacity }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
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
            <filter id="i-motion" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={`${motionBlur * 0.15} ${motionBlur}`} /></filter>
            <filter id="i-word" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation={12 * (1 - wordK)} /></filter>
            <filter id="i-tag" x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation={8 * (1 - tagK)} /></filter>
          </defs>

          {/* небо: четыре ровные полосы, звёзды-искорки, солнце или луна — плоские диски с кольцами */}
          {[0, 0.18, 0.4, 0.68].map((f0, i, arr) => {
            const f1 = arr[i + 1] ?? 1;
            return <rect key={`sky${i}`} x="0" y={HORIZON * (1 - f1)} width={W} height={HORIZON * (f1 - f0) + 1} fill={C.skyBands[i]} />;
          })}
          {C.stars > 0.02 && scene.stars.map((s, i) => {
            const on = Math.sin(T * s.sp + s.ph) > -0.4 ? 1 : 0.25;
            const r = 2 + s.s * 2.4;
            return <path key={i} d={`M${s.x - r},${s.y}H${s.x + r}M${s.x},${s.y - r}V${s.y + r}`} stroke="#FFF9EA" strokeWidth="1.3" strokeLinecap="round" opacity={on * C.stars * 0.9} />;
          })}
          {C.body && (
            <g>
              <circle cx={C.body.x} cy={C.body.y} r={C.body.sun ? 88 : 64} fill={C.bodyC} opacity="0.1" />
              <circle cx={C.body.x} cy={C.body.y} r={C.body.sun ? 58 : 46} fill={C.bodyC} opacity="0.2" />
              <circle cx={C.body.x} cy={C.body.y} r={C.body.sun ? 36 : 30} fill={C.bodyC} />
              {!C.body.sun && C.body.illum < 0.97 && (
                <circle cx={C.body.x + (C.body.waxing ? -1 : 1) * 60 * C.body.illum} cy={C.body.y} r="30.5" fill={C.band} opacity="0.94" />
              )}
            </g>
          )}

          {/* море: плоские слои глубины, ленты зыби, значки волн «~», мигающая дорожка под светилом */}
          {[0, 0.06, 0.2, 0.45].map((f0, i, arr) => {
            const f1 = arr[i + 1] ?? 1;
            return <rect key={`sea${i}`} x="0" y={HORIZON + (H - HORIZON) * f0} width={W} height={(H - HORIZON) * (f1 - f0) + 1} fill={C.seaBands[i]} />;
          })}
          {Array.from({ length: 9 }, (_, i) => {
            const p = ((i / 9 + T * 0.03) % 1);
            const k = p ** 1.9;
            const y = HORIZON + (H - HORIZON) * k;
            return <rect key={`sw${i}`} x="0" y={y} width={W} height={2 + 30 * k} fill={C.line} opacity={Math.sin(Math.PI * p) > 0.55 ? 0.07 : 0} />;
          })}
          {scene.streaks.map((s, i) => {
            const k = (s.y - HORIZON) / (H - HORIZON);
            const L = 6 + 26 * k, A = 1.5 + 6 * k;
            const x = s.x + Math.sin(T * 0.8 + i) * (2 + 6 * k);
            return <path key={`wv${i}`} d={`M${x - L},${s.y} q${L / 2},${-A} ${L},0 t${L},0`} fill="none" stroke={C.line} strokeWidth={1 + 1.6 * k}
              strokeLinecap="round" opacity={0.25 + 0.4 * k} />;
          })}
          {C.body && scene.glints.map((g, i) => {
            const k = (g.y - HORIZON) / (H - HORIZON);
            const len = 8 + k * 90 * (0.4 + g.j);
            const x = C.body!.x + (g.j - 0.5) * (6 + k * 50) - len / 2;
            const on = Math.sin(T * g.sp * 1.4 + g.ph) > -0.2 ? 1 : 0;
            return <rect key={`gl${i}`} x={x} y={g.y} width={len} height={2 + k * 3} rx={1 + k * 1.5} fill={C.bodyC} opacity={on * (C.body!.sun ? 0.95 : 0.8)} />;
          })}

          {/* горизонт: чёткая линия и плоские острова */}
          <rect y={HORIZON - 1} width={W} height="2" fill={C.horizon} opacity="0.55" />
          {scene.islands.map((d, i) => <path key={`is${i}`} d={d} fill={C.island} />)}

          {/* круги от падения и сигнал буя */}
          {tau > 0 && [0, 0.22, 0.44].map((d, k) => {
            const a = tau - d;
            if (a <= 0) return null;
            const rx = MW * 0.5 + 250 * a;
            return <ellipse key={`r${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.line} strokeWidth="2" opacity={Math.max(0, 0.7 * (1 - a / 2.4))} />;
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
            <g clipPath="url(#i-below)" mask="url(#i-reflMask)" opacity="0.24">
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
              fill="none" stroke={C.line} strokeWidth="2" opacity={0.55} />
          )}

          {/* пена, брызги штрихами по траектории, пузыри */}
          {tau > 0 && tau < 0.7 && (
            <ellipse cx={CX} cy={WATER} rx={MW * (0.6 + tau * 1.2)} ry={9 + tau * 6} fill={C.primary} opacity={0.5 * (1 - tau / 0.7)} />
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
