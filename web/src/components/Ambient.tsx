import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';

/** Цвет бликов по режиму: лунный → янтарный → отсвет сигнальной ракеты. */
const TINT: Record<Mode, [number, number, number]> = {
  calm: [0.86, 0.91, 0.95], alertness: [1, 0.8, 0.5], alarm: [1, 0.56, 0.5], intercept: [1, 0.62, 0.55],
};
/** Волнение и скорость течения по режиму. */
const SEA: Record<Mode, { chop: number; speed: number }> = {
  calm: { chop: 0, speed: 1 }, alertness: { chop: 0.45, speed: 1.25 }, alarm: { chop: 1, speed: 1.6 }, intercept: { chop: 0.8, speed: 1.45 },
};

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// Ночная вода: течения из искажённого шума, вытянутые по горизонтали, к горизонту рябь мельчает.
// Лунная дорожка — острые блики на гребнях в колонке света; кольцо ряби искажает саму воду.
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uLight;uniform float uPower;uniform vec3 uTint;
uniform float uChop;uniform vec4 uPulse;uniform float uAppear;
float ringLight=0.;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<4;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float depth=mix(1.,3.6,uv.y);
  vec2 q=vec2((uv.x-.5)*asp*depth*.6,depth*2.3);
  vec2 sp=vec2((uv.x-.5)*asp,uv.y);
  if(uPulse.w>0.){
    vec2 c=vec2((uPulse.x-.5)*asp,uPulse.y);
    float d=distance(sp,c);
    float r=uPulse.z*.42;
    float k=(d-r)*11.;
    float env=exp(-k*k)*exp(-uPulse.z*.9)*uPulse.w;
    q+=normalize(sp-c+1e-4)*sin((d-r)*70.)*env*.09;
    ringLight=env*(.5+.5*sin((d-r)*70.))*.09;          // отблеск самого кольца
  }
  float t=uT;
  vec2 a=vec2(fbm(q+vec2(t*.045,0.)),fbm(q+vec2(5.2,1.3)-vec2(0.,t*.035)));
  vec2 b=vec2(fbm(q+2.1*a+vec2(1.7,9.2)+t*.06),fbm(q+2.1*a+vec2(8.3,2.8)-t*.045));
  float f=fbm(q+(1.5+uChop*.9)*b);
  float rip=noise(q*vec2(2.6,5.4)+b*(2.6+uChop*1.6)+vec2(t*.5,-t*.2));
  float ridge=1.-abs(rip*2.-1.);
  vec3 col=mix(vec3(.028,.058,.11),vec3(.058,.105,.17),smoothstep(.28,.82,f));
  col=mix(col,vec3(.075,.12,.18),smoothstep(.5,1.,uv.y)*.55);
  float w=mix(.34,.07,uv.y);
  float dx=(uv.x-uLight.x)*asp;
  float column=exp(-dx*dx/(w*w));
  float glint=pow(ridge,mix(16.,42.,uv.y))*column*uPower;
  float sheen=smoothstep(.56,.95,f)*.07;
  col+=uTint*(glint*1.5+sheen+column*.045*uPower+ringLight);
  col*=mix(.62,1.,smoothstep(1.25,.25,distance(uv,vec2(.5,.52))));
  gl_FragColor=vec4(col*uAppear,1.);
}`;

/** Доля пути к цели за кадр — одинаковая плавность на 60 и на 144 Гц. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

type Uniforms = { t: number; lx: number; ly: number; power: number; tint: number[]; chop: number; pulse: number[]; appear: number };

function createWater(canvas: HTMLCanvasElement, force: boolean) {
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: !force,                 // на программном рендере — запасной фон
  });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX), fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uRes', 'uT', 'uLight', 'uPower', 'uTint', 'uChop', 'uPulse', 'uAppear'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  let scale = 0.5;   // вода мягкая: половины разрешения хватает, видеокарта отдыхает
  return {
    resize(w: number, h: number) {
      canvas.width = Math.max(2, Math.round(Math.min(w, 2400) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w: number, h: number) { scale = 0.34; this.resize(w, h); },
    draw(s: Uniforms) {
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uT, s.t);
      gl.uniform2f(u.uLight, s.lx, s.ly);
      gl.uniform1f(u.uPower, s.power);
      gl.uniform3f(u.uTint, s.tint[0], s.tint[1], s.tint[2]);
      gl.uniform1f(u.uChop, s.chop);
      gl.uniform4f(u.uPulse, s.pulse[0], s.pulse[1], s.pulse[2], s.pulse[3]);
      gl.uniform1f(u.uAppear, s.appear);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/**
 * Живой фон — ночная вода на видеокарте. Течения медленно перетекают, рябь мельчает к горизонту,
 * лунная дорожка мерцает бликами и мягко идёт за курсором; яркость — освещённость луны этой ночью.
 * Клик пускает по воде кольцо ряби, тревога — кольцо от центра и красноватые блики.
 * Без видеокарты или при «уменьшить движение» — спокойный запасной фон (CSS), без покадровой анимации.
 */
export default function Ambient({ mode, quiet = false, moon = 0.3 }: { mode: Mode; quiet?: boolean; moon?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, quiet, moon });
  const pulse = useRef<{ x: number; y: number; t0: number; k: number } | null>(null);
  live.current = { mode, quiet, moon };

  useEffect(() => {
    if (mode === 'alarm' || mode === 'alertness') pulse.current = { x: 0.5, y: 0.42, t0: performance.now(), k: mode === 'alarm' ? 1 : 0.6 };
  }, [mode]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const force = new URLSearchParams(location.search).has('sea');   // для проверки на машине без видеокарты
    let water: ReturnType<typeof createWater> = null;
    try { water = reducedMotion() ? null : createWater(cv, force); } catch { water = null; }
    if (!water) { cv.style.display = 'none'; return; }
    cv.parentElement?.classList.add('has-water');
    const sea = water;

    let w = 0, h = 0, raf = 0, prev = 0, slow = 0, quietAt = 0;
    const startAt = performance.now();
    const m0 = live.current.mode;
    const s: Uniforms & { speed: number } = {
      t: 0, lx: 0.72, ly: 0.5, power: 0.25 + live.current.moon * 0.75, tint: [...TINT[m0]], chop: SEA[m0].chop,
      speed: SEA[m0].speed, pulse: [0, 0, 0, 0], appear: 0,
    };
    const ptr = { x: 0.72, moved: -1e9 };

    const resize = () => { w = innerWidth; h = innerHeight; sea.resize(w, h); };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { prev = 0; return; }
      const { mode: m, quiet: q, moon: mn } = live.current;
      if (q && now - quietAt < 80) return;              // на карте фон почти закрыт — 12 кадров в секунду
      quietAt = now;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 1 / 60;
      prev = now;

      s.speed += (SEA[m].speed - s.speed) * follow(0.6, dt);   // море разгоняется и стихает плавно
      s.t += dt * s.speed;
      s.chop += (SEA[m].chop - s.chop) * follow(0.5, dt);
      for (let k = 0; k < 3; k++) s.tint[k] += (TINT[m][k] - s.tint[k]) * follow(1.2, dt);
      // дорожка света идёт за курсором с инерцией, в покое возвращается на место
      const moving = now - ptr.moved < 1800;
      s.lx += ((moving ? ptr.x : 0.72) - s.lx) * follow(moving ? 2.2 : 0.35, dt);
      // яркость дорожки — освещённость луны; даже в безлунную ночь небо немного светится
      s.power += ((0.25 + mn * 0.75) * (moving ? 1.2 : 1) - s.power) * follow(1.4, dt);
      const a = Math.min(1, (now - startAt) / 1600);
      s.appear = 1 - (1 - a) ** 3;
      const p = pulse.current;
      if (p) {
        const age = (now - p.t0) / 1000;
        if (age > 4.5) pulse.current = null;
        s.pulse = [p.x, p.y, age, p.k];
      } else s.pulse = [0, 0, 0, 0];
      sea.draw(s);

      // слабая видеокарта: стабильно меньше 30 кадров — снижаем разрешение
      if (!q) { slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 1); if (slow > 90) { sea.lower(w, h); slow = -1e9; } }
    };

    const onMove = (e: PointerEvent) => { ptr.x = e.clientX / innerWidth; ptr.moved = performance.now(); };
    const onDown = (e: PointerEvent) => {
      if (live.current.quiet) return;
      pulse.current = { x: e.clientX / innerWidth, y: 1 - e.clientY / innerHeight, t0: performance.now(), k: 0.55 };
    };
    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <div aria-hidden className="sea pointer-events-none fixed inset-0">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
