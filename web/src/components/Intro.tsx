import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SeaSound } from '../introSound';
import { useSoundOn } from '../sound';

/**
 * Интро: ночное море дельты. Знак падает, как поплавок, — бульк, брызги, круги по воде,
 * игла уходит под воду, щит покачивается над ней; буй подаёт сигнал, проявляется «404».
 */

const W = 1600, H = 900, HORIZON = 470, WATER = 610, CX = 800;
const MARK_RATIO = 819.83 / 1250;        // ширина / высота знака (brand/src/mark-data.mjs)
const MH = 210, MW = MH * MARK_RATIO;
const SETTLED = WATER - 0.8 * MH;         // в покое над водой щит и крылья, игла — под водой
const START = -MH - 60, IMPACT = WATER - MH;
const T_FALL = 0.85, T_PING = 2.2, T_WORD = 2.7, T_TAG = 3.3, T_OUT = 5.6;
const C = { primary: '#E2E8F0', accent: '#7A866F', muted: '#A2A9B4', reed: '#040A14' };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
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
  if (t < T_FALL) return START + (IMPACT - START) * (t / T_FALL) ** 2;
  const tau = t - T_FALL;
  return bobTop(tau) + 3 * Math.sin(1.6 * t) * (1 - Math.exp(-tau));
}
function markTilt(t: number) {
  if (t < T_FALL) return 5 * Math.sin(t * 4);
  const tau = t - T_FALL;
  return 7 * Math.exp(-1.4 * tau) * Math.sin(6 * tau) + 1.2 * Math.sin(1.3 * t);
}

function useScene() {
  return useMemo(() => {
    const r = rng(404);
    const stars = Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * (HORIZON - 40), s: 0.5 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 1.6 }));
    const glints = Array.from({ length: 44 }, () => ({ y: HORIZON + 6 + r() ** 1.6 * (H - HORIZON), ph: r() * 6.28, sp: 1 + r() * 2.5, j: r() }));
    const streaks = Array.from({ length: 30 }, () => ({ x: r() * W, y: HORIZON + 8 + r() ** 1.3 * (H - HORIZON), l: 30 + r() * 130, sp: 4 + r() * 10, o: 0.03 + r() * 0.07 }));
    const drops = Array.from({ length: 24 }, () => {
      const a = (25 + r() * 130) * (Math.PI / 180);
      return { vx: Math.cos(a) * (180 + r() * 380), vy: -Math.sin(a) * (300 + r() * 420), r: 1.6 + r() * 3.2 };
    });
    const bubbles = Array.from({ length: 9 }, (_, i) => ({ t: T_FALL + 0.15 + i * 0.14 + r() * 0.12, dx: (r() - 0.5) * MW * 0.9, f: 600 + r() * 500 }));
    // камыш: стебли-лезвия и рогоз
    const reeds: { x: number; h: number; lean: number; w: number; head: boolean; ph: number }[] = [];
    for (const side of [0, 1]) {
      for (let i = 0; i < 17; i++) {
        const x = side === 0 ? -30 + r() * 300 : W - 270 + r() * 300;
        reeds.push({ x, h: 330 + r() * 300, lean: (side === 0 ? 1 : -1) * (6 + r() * 26) + (r() - 0.5) * 20, w: 5 + r() * 6, head: r() < 0.35, ph: r() * 6.28 });
      }
    }
    // дальние острова дельты на горизонте: слева и справа, по центру — открытая вода
    const shore = (x0: number, x1: number) => {
      let d = `M${x0},${HORIZON + 2}`;
      for (let x = x0; x <= x1; x += 18) d += ` L${x},${HORIZON - 3 - r() * 9 - (r() < 0.12 ? 7 : 0)}`;
      return d + ` L${x1},${HORIZON + 2} Z`;
    };
    const islands = [shore(-20, 560), shore(1060, 1300), shore(1380, 1620)];
    return { stars, glints, streaks, drops, bubbles, reeds, islands };
  }, []);
}

interface Props { onDone: () => void }

export default function Intro({ onDone }: Props) {
  const scene = useScene();
  const soundOn = useSoundOn();
  const [phase, setPhase] = useState<'gate' | 'run' | 'out'>('gate');
  const [clock, setClock] = useState({ T: 0, t: -1 });  // T — общее время сцены, t — от нажатия
  const born = useRef(performance.now());
  const started = useRef<number | null>(null);
  const sound = useRef<SeaSound | null>(null);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    sound.current?.fadeOut(0.6);
    setPhase('out');
    window.setTimeout(onDone, 650);
  }, [onDone]);

  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const T = (now - born.current) / 1000;
      const t = started.current == null ? -1 : (now - started.current) / 1000;
      setClock({ T, t });
      if (t >= T_OUT && !finished.current) finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [finish]);

  const start = () => {
    if (soundOn) try {
      const s = new SeaSound();
      s.startWaves();
      s.whoosh(s.at(0.05), T_FALL - 0.05);
      s.plop(s.at(T_FALL));
      scene.bubbles.forEach((b) => s.bubble(s.at(b.t), b.f));
      s.ping(s.at(T_PING));
      sound.current = s;
    } catch { /* без звука — анимация всё равно идёт */ }
    started.current = performance.now();
    setPhase('run');
  };

  const { T, t } = clock;
  const live = t >= 0;
  const tau = t - T_FALL;
  const top = live ? markTop(t) : START;
  const tilt = live ? markTilt(t) : 0;
  const markG = (
    <g transform={`rotate(${tilt} ${CX} ${WATER}) translate(${CX - MW / 2} ${top})`}>
      <image href="/brand/404-logo-cream.svg" width={MW} height={MH} />
    </g>
  );
  const surface = (x: number) => WATER + 3 * Math.sin(x * 0.011 + T * 1.3) + 1.5 * Math.sin(x * 0.029 - T * 1.9);

  return (
    <div role="dialog" aria-label="Заставка 404"
      className={`fixed inset-0 z-[3000] bg-bg transition-opacity duration-700 ${phase === 'out' ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#070F1D" />
            <stop offset="0.75" stopColor="#0B1628" />
            <stop offset="1" stopColor="#1A2C49" />
          </linearGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1A2C49" />
            <stop offset="0.25" stopColor="#0F1E36" />
            <stop offset="1" stopColor="#060D19" />
          </linearGradient>
          <radialGradient id="moonGlow">
            <stop offset="0" stopColor="#E2E8F0" stopOpacity="0.35" />
            <stop offset="1" stopColor="#E2E8F0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E2E8F0" stopOpacity="0" />
            <stop offset="0.5" stopColor="#E2E8F0" stopOpacity="0.07" />
            <stop offset="1" stopColor="#E2E8F0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="reflFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="reflMask" maskUnits="userSpaceOnUse">
            <rect x="0" y={WATER} width={W} height={MH * 0.9} fill="url(#reflFade)" />
          </mask>
          <clipPath id="above"><rect x="0" y="0" width={W} height={WATER + 1} /></clipPath>
          <clipPath id="below"><rect x="0" y={WATER} width={W} height={H - WATER} /></clipPath>
        </defs>

        {/* небо, звёзды, луна */}
        <rect width={W} height={HORIZON} fill="url(#sky)" />
        {scene.stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.s} fill={C.primary} opacity={0.25 + 0.55 * (0.5 + 0.5 * Math.sin(T * s.sp + s.ph))} />
        ))}
        <circle cx="1235" cy="165" r="120" fill="url(#moonGlow)" />
        <circle cx="1235" cy="165" r="30" fill="#E8EDF4" />
        <circle cx="1247" cy="158" r="27" fill="#0B1628" opacity="0.18" />

        {/* море */}
        <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#sea)" />
        {scene.streaks.map((s, i) => {
          const x = ((s.x + T * s.sp) % (W + 200)) - 100;
          const k = (s.y - HORIZON) / (H - HORIZON);
          return <rect key={i} x={x} y={s.y} width={s.l * (0.4 + k)} height={1 + k * 1.2} rx="1" fill={C.primary} opacity={s.o} />;
        })}
        {/* лунная дорожка */}
        {scene.glints.map((g, i) => {
          const k = (g.y - HORIZON) / (H - HORIZON);
          const len = 6 + k * 90 * (0.4 + g.j);
          const x = 1235 + Math.sin(T * 0.7 + g.ph) * (4 + k * 40) - len / 2;
          return <rect key={i} x={x} y={g.y} width={len} height={1 + k * 2} rx="1" fill="#E8EDF4"
            opacity={(0.15 + 0.5 * (0.5 + 0.5 * Math.sin(T * g.sp + g.ph))) * (1 - k * 0.55)} />;
        })}
        <rect y={HORIZON - 45} width={W} height="100" fill="url(#haze)" />
        {scene.islands.map((d, i) => <path key={`is${i}`} d={d} fill="#0A1424" opacity="0.9" />)}

        {/* круги от падения и сигнал буя */}
        {live && tau > 0 && [0, 0.22, 0.44].map((d, k) => {
          const a = tau - d;
          if (a <= 0) return null;
          const rx = MW * 0.5 + 250 * a;
          return <ellipse key={`r${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.primary} strokeWidth="1.5" opacity={Math.max(0, 0.55 * (1 - a / 2.4))} />;
        })}
        {live && [0, 0.45].map((d, k) => {
          const a = t - T_PING - d;
          if (a <= 0 || a > 2.2) return null;
          const rx = MW * 0.45 + 420 * a;
          return <ellipse key={`p${k}`} cx={CX} cy={WATER} rx={rx} ry={rx * 0.16} fill="none" stroke={C.accent} strokeWidth="2.5" opacity={Math.max(0, 0.9 * (1 - a / 2.0))} />;
        })}

        {/* отражение щита в воде */}
        {live && (
          <g clipPath="url(#below)" mask="url(#reflMask)" opacity="0.22">
            <g transform={`translate(${CX} ${WATER}) skewX(${Math.sin(T * 2.2) * 4}) translate(${-CX} ${-WATER}) translate(0 ${2 * WATER}) scale(1 -1)`}>
              {markG}
            </g>
          </g>
        )}
        {/* поплавок: над водой — целиком, под водой — едва видно */}
        {live && (
          <>
            <g clipPath="url(#below)" opacity="0.14">{markG}</g>
            <g clipPath="url(#above)">{markG}</g>
          </>
        )}
        {live && tau > 0 && (
          <path d={`M${CX - MW * 0.7},${surface(CX - MW * 0.7)} Q${CX},${WATER + 5} ${CX + MW * 0.7},${surface(CX + MW * 0.7)}`}
            fill="none" stroke={C.primary} strokeWidth="1.5" opacity={0.35} />
        )}

        {/* пена, брызги, пузыри */}
        {live && tau > 0 && tau < 0.7 && (
          <ellipse cx={CX} cy={WATER} rx={MW * (0.6 + tau * 1.2)} ry={9 + tau * 6} fill={C.primary} opacity={0.4 * (1 - tau / 0.7)} />
        )}
        {live && tau > 0 && tau < 1.3 && scene.drops.map((d, i) => {
          const x = CX + d.vx * tau;
          const y = WATER - 12 + d.vy * tau + 0.5 * 1500 * tau * tau;
          if (y > WATER + 2) return null;
          return <circle key={`d${i}`} cx={x} cy={y} r={d.r} fill={C.primary} opacity={Math.max(0, 1 - tau / 1.2)} />;
        })}
        {live && scene.bubbles.map((b, i) => {
          const a = t - b.t;
          if (a < 0 || a > 0.45) return null;
          return <circle key={`b${i}`} cx={CX + b.dx} cy={WATER - 2 - a * 6} r={2 + a * 12} fill="none" stroke={C.primary} strokeWidth="1.2" opacity={0.7 * (1 - a / 0.45)} />;
        })}

        {/* камыш на переднем плане */}
        {scene.reeds.map((r, i) => {
          const sway = Math.sin(T * 0.9 + r.ph) * 2.2;
          const bx = r.x, by = H + 30, tx = bx + r.lean, ty = by - r.h;
          return (
            <g key={`reed${i}`} transform={`rotate(${sway} ${bx} ${by})`}>
              <path d={`M${bx - r.w / 2},${by} Q${bx + r.lean * 0.3},${by - r.h * 0.55} ${tx},${ty} Q${bx + r.lean * 0.35 + r.w * 0.4},${by - r.h * 0.5} ${bx + r.w / 2},${by} Z`} fill={C.reed} />
              {r.head && <ellipse cx={bx + r.lean * 0.78} cy={by - r.h * 0.8} rx={r.w * 0.9} ry={r.w * 3.6}
                transform={`rotate(${r.lean * 0.25} ${bx + r.lean * 0.78} ${by - r.h * 0.8})`} fill={C.reed} />}
            </g>
          );
        })}

        {/* название */}
        {live && (
          <g opacity={ease((t - T_WORD) / 0.9)} transform={`translate(0 ${(1 - ease((t - T_WORD) / 0.9)) * 14})`}>
            <image href="/brand/404-wordmark-cream.svg" x={CX - 190} y={170} width={380} height={380 / 4.09} />
          </g>
        )}
        {live && (
          <text x={CX} y={318} textAnchor="middle" fill={C.muted} fontFamily="Inter, sans-serif" fontSize="20" fontWeight="600"
            letterSpacing="6" opacity={ease((t - T_TAG) / 0.8)}>
            БРАКОНЬЕР НЕ НАЙДЕН
          </text>
        )}
      </svg>

      {phase === 'gate' && (
        <div className="absolute inset-x-0 top-[24%] flex flex-col items-center gap-6 px-4 text-center">
          <img src="/brand/404-wordmark-cream.svg" alt="404" className="h-auto w-[180px] opacity-90" />
          <div className="cap">Эко-щит Каспия · ночное дежурство</div>
          <button onClick={start} autoFocus
            className="h-12 rounded-[12px] border border-accent bg-accent/15 px-7 text-[15px] font-semibold text-primary transition hover:bg-accent/30">
            Заступить на дежурство
          </button>
          <div className="text-[12px] text-muted">{soundOn ? 'Со звуком' : 'Звук выключен'} · <button onClick={finish} className="underline decoration-line underline-offset-4 hover:text-primary">пропустить</button></div>
        </div>
      )}
      {phase === 'run' && (
        <button onClick={finish} className="absolute right-4 top-4 rounded-chip border border-line px-3 py-1.5 text-[12px] text-muted hover:text-primary">
          Пропустить
        </button>
      )}
    </div>
  );
}

