import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';
import Reeds from './Reeds';
import { currentSky, liveAt, skyBodies } from '../theme';
import { hex, palAt, type Pal, type V3 } from '../skyPalette';

/** Режим подкрашивает море: настороженность — янтарём, тревога — красным */
const TINT: Record<Mode, { c: V3; k: number }> = {
  calm: { c: [0, 0, 0], k: 0 }, alertness: { c: hex('#F59E0B'), k: 0.12 }, alarm: { c: hex('#EF4444'), k: 0.18 }, intercept: { c: hex('#EF4444'), k: 0.14 },
};
const SPEED: Record<Mode, number> = { calm: 1, alertness: 1.2, alarm: 1.55, intercept: 1.4 };

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// Своя стилистика — между реализмом и графикой, всё плавное: небо мягким градиентом, мягкое свечение
// солнца и луны (луна в фазе, с пепельным светом), звёзды-точки, слоистые облака у горизонта,
// острова в дымке. Вода — течения и зыбь, свет мягкими мазками, под светилом переливается дорожка.
// Почерк 404 — изобаты: тонкие плавные линии на воде, как на морской карте и экране сонара.
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;uniform float uGain;uniform vec4 uPulse;
uniform vec3 uTop;uniform vec3 uHz;uniform vec3 uFar;uniform vec3 uNear;uniform vec3 uLine;uniform vec3 uIsle;
uniform vec3 uSunC;uniform vec3 uMoonC;uniform vec4 uSun;uniform vec4 uMoon;uniform float uStars;uniform float uClouds;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<3;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
const float HZ=.8;
vec2 plane(vec2 uv,float asp){float below=max(HZ-uv.y,.001);float d=1./(below+.06);return vec2((uv.x-.5)*asp*d*.35,d);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float below=HZ-uv.y;
  vec2 ds=(uv-uSun.xy)*vec2(asp,1.);float rs=length(ds);
  vec2 dm=(uv-uMoon.xy)*vec2(asp,1.);float rm=length(dm);
  float moonLight=uMoon.z*(.3+.7*abs(uMoon.w));
  vec3 col;
  if(below<0.){
    // ---- небо: мягкий градиент, свечение светил ----
    float a=clamp(-below/(1.-HZ),0.,1.);
    col=mix(uHz,uTop,smoothstep(0.,1.,pow(a,.7)));
    col+=uSunC*(exp(-rs*rs*14.)*.28+exp(-rs*rs*160.)*.32)*uSun.z;
    col+=uMoonC*(exp(-rm*rm*60.)*.07+exp(-rm*rm*600.)*.1)*moonLight;
    // звёзды — мягкие точки, медленно мерцают; у горизонта тонут в дымке
    vec2 sp=vec2(uv.x*asp,uv.y)*140.;vec2 cell=floor(sp);float h=hash(cell);
    vec2 off=vec2(hash(cell+3.1),hash(cell+7.7))-.5;
    float st=step(.962,h)*smoothstep(.3,0.,length(fract(sp)-.5-off*.55));
    col+=vec3(.9,.93,1.)*st*(.55+.45*sin(uT*(.4+h*1.2)+h*60.))*.8*uStars*smoothstep(0.,.07,a);
    // слоистые облака у горизонта — вытянутые, мягкие, подсвечены светилом
    float cl=fbm(vec2(uv.x*asp*1.3+uT*.005,uv.y*11.));
    float cloud=smoothstep(.52,.78,cl)*smoothstep(0.,.12,a)*smoothstep(.85,.3,a)*uClouds;
    vec3 cc=mix(uHz,uTop,.35)*1.06+uSunC*.12*uSun.z+uMoonC*.04*moonLight;
    col=mix(col,cc,cloud*.5);
    // солнце — мягкий диск
    col=mix(col,uSunC,smoothstep(uSun.w,uSun.w*.72,rs)*uSun.z);
    // луна — мягкий диск в фазе: тень — сдвинутый диск с размытым краем, пепельный свет
    float R=.021;
    float disc=smoothstep(R,R*.84,rm);
    float ph=abs(uMoon.w),side=uMoon.w<0.?-1.:1.;
    float shade=smoothstep(R*1.04,R*.74,length(dm+vec2(side*2.*R*ph,0.)));
    col=mix(col,col*.8+uMoonC*.05,disc*uMoon.z);
    col=mix(col,uMoonC,disc*(1.-shade)*uMoon.z);
  }else{
    // ---- вода ----
    vec2 w=plane(uv,asp);
    float t=uT;
    float ring=0.;
    if(uPulse.w>0.){                                       // клик и тревога — мягкая волна по воде
      vec2 c=plane(vec2(uPulse.x,uPulse.y),asp);
      float r=uPulse.z*1.6;
      float dw=distance(w*vec2(1.,.55),c*vec2(1.,.55));
      float k=(dw-r)*2.2;
      ring=exp(-k*k)*exp(-uPulse.z*1.1)*uPulse.w;
      w+=normalize(w-c+1e-4)*sin((dw-r)*9.)*ring*.18;
    }
    vec2 q=vec2(fbm(w*.6+vec2(t*.03,0.)),fbm(w*.6+vec2(5.2,1.3)-vec2(0.,t*.02)));
    float f=fbm(w*.6+2.*q+vec2(0.,-t*.05));
    float depth=clamp(below/HZ,0.,1.);
    vec3 water=mix(uFar,uNear,smoothstep(0.,1.,pow(depth,.5)));
    water=mix(water,water*1.1+uLine*.02,smoothstep(.35,.8,f)*.6);          // течения
    float swell=.5+.5*sin(w.y*2.2-t*.85+f*3.);
    water+=uLine*swell*.025;
    // изобаты: тонкие плавные линии на воде, огибают течения
    float iso=fract(w.y*.55+f*1.4+sin(w.x*.22+t*.08)*.5);
    float lw=max(.06,(1.5/uRes.y)/((below+.06)*(below+.06))*.55*1.5);
    water+=uLine*(1.-smoothstep(0.,lw,abs(iso-.5)))*.07*smoothstep(.04,.3,depth);
    // мазки света на ряби
    float nearK=mix(2.,1.,clamp((w.y-1.)/5.,0.,1.));
    float s1=noise(vec2(w.x*3.,w.y*6.)*nearK+q*2.+vec2(t*.12,-t*.55));
    water+=uLine*smoothstep(.58,.88,s1)*smoothstep(.15,.95,swell)*.06;
    // дорожка под солнцем и луной: переливающиеся блики, к зрителю шире
    float g=noise(vec2(w.x*7.,w.y*16.)+q*3.+vec2(t*.25,-t*1.1));
    float glit=smoothstep(.45,.95,g)*smoothstep(.1,.9,swell+.3);
    float wd=mix(.02,.36,depth);
    float ls=(uv.x-uSun.x)*asp;float ps=exp(-ls*ls/(wd*wd));
    float lm=(uv.x-uMoon.x)*asp;float pm=exp(-lm*lm/(wd*wd*.8));
    water+=uSunC*ps*(glit*.85+.07)*uSun.z;
    water+=uMoonC*pm*(glit*.7+.035)*moonLight;
    float lp=(uv.x-uPtr.x)*asp;
    water+=uLine*exp(-lp*lp/(wd*wd*.6))*glit*.22*uPower;
    water+=uLine*ring*.1;
    col=mix(water,uHz,smoothstep(.12,0.,below)*.6);                         // у горизонта вода тонет в дымке
  }
  col+=mix(uHz,vec3(1.),.3)*exp(-pow((uv.y-HZ)*60.,2.))*.1;               // светлая дымка горизонта
  // острова дельты: мягкие силуэты в дымке и их отражение
  float hx=uv.x*asp;
  float isle=smoothstep(.44,.6,noise(vec2(hx*2.2,4.1)));
  float ih=(.003+.011*fbm(vec2(hx*20.,1.7)))*isle;
  float a2=uv.y-HZ;
  vec3 ic=mix(uIsle,uHz,.22);
  col=mix(col,ic,(1.-smoothstep(ih-.0025,ih+.0008,a2))*smoothstep(-.0012,.0012,a2)*isle*.9);
  col=mix(col,mix(col,ic,.45),(1.-smoothstep(ih*.75-.003,ih*.75+.001,-a2))*smoothstep(-.001,.002,-a2)*isle*.5);
  col*=mix(.82,1.,smoothstep(1.25,.35,distance(uv,vec2(.5,.55))));         // мягкая виньетка
  col+=(hash(gl_FragCoord.xy+fract(uT))-.5)/255.;                           // против полос на градиенте
  gl_FragColor=vec4(col*uGain,1.);
}`;

/** Доля пути к цели за кадр — одинаковая плавность на 60 и на 144 Гц. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

interface Frame {
  t: number; ptr: number[]; power: number; gain: number; pulse: number[];
  pal: Pal; moonC: V3; sun: number[]; moon: number[];
}

function createSea(canvas: HTMLCanvasElement, force: boolean) {
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
  const names = ['uRes', 'uT', 'uPtr', 'uPower', 'uGain', 'uPulse', 'uTop', 'uHz', 'uFar', 'uNear', 'uLine', 'uIsle', 'uSunC', 'uMoonC', 'uSun', 'uMoon', 'uStars', 'uClouds'];
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
  let scale = 0.5;   // мягкая картинка: половины разрешения хватает
  return {
    resize(w: number, h: number) {
      canvas.width = Math.max(2, Math.round(Math.min(w, 2200) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w: number, h: number) { scale = 0.3; this.resize(w, h); },
    draw(f: Frame) {
      const v3 = (n: string, c: V3) => gl.uniform3f(u[n], c[0], c[1], c[2]);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uT, f.t);
      gl.uniform2f(u.uPtr, f.ptr[0], f.ptr[1]);
      gl.uniform1f(u.uPower, f.power);
      gl.uniform1f(u.uGain, f.gain);
      gl.uniform4f(u.uPulse, f.pulse[0], f.pulse[1], f.pulse[2], f.pulse[3]);
      v3('uTop', f.pal.top); v3('uHz', f.pal.hz); v3('uFar', f.pal.far); v3('uNear', f.pal.near);
      v3('uLine', f.pal.line); v3('uIsle', f.pal.isle); v3('uSunC', f.pal.sun); v3('uMoonC', f.moonC);
      gl.uniform4f(u.uSun, f.sun[0], f.sun[1], f.sun[2], f.sun[3]);
      gl.uniform4f(u.uMoon, f.moon[0], f.moon[1], f.moon[2], f.moon[3]);
      gl.uniform1f(u.uStars, f.pal.stars);
      gl.uniform1f(u.uClouds, f.pal.clouds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

const MOON_WHITE = hex('#EEF1F8'), MOON_LOW = hex('#F2C79A');
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixV = (a: V3, b: V3, k: number) => a.map((v, i) => v + (b[i] - v) * k) as V3;

/** Небо на этот кадр: в «Авто» — настоящее положение светил сейчас (каждый кадр), иначе — ровная ночь или день */
function skyNow(moonProp: number) {
  const sky = currentSky();
  if (sky.pref === 'auto') {
    const b = skyBodies(liveAt());
    return { sunAlt: b.sunAlt, sun: b.sun, moon: b.moon };
  }
  return { sunAlt: sky.sunAlt, sun: sky.sun, moon: { ...sky.moon, illum: moonProp, waxing: true } };
}

/** Цели кадра: палитра по высоте солнца с подкраской режима; у горизонта луна теплее, как в жизни */
function targets(mode: Mode, moonProp: number) {
  const now = skyNow(moonProp);
  const base = palAt(now.sunAlt);
  const tint = TINT[mode];
  const tn = (c: V3, k: number) => c.map((v, i) => v + (tint.c[i] - v) * tint.k * k) as V3;
  const pal: Pal = { ...base, far: tn(base.far, 1), near: tn(base.near, 0.6), hz: tn(base.hz, 0.5), line: tn(base.line, 0.4) };
  const phase = (now.moon.waxing ? 1 : -1) * Math.max(0.001, now.moon.illum);
  return {
    pal,
    moonC: mixV(MOON_LOW, MOON_WHITE, smooth(0, 14, now.moon.alt)),
    sun: [now.sun.x, now.sun.y, now.sun.visible, 0.026],
    moon: [now.moon.x, now.moon.y, now.moon.visible, phase],
  };
}

/**
 * Светило идёт за настоящим положением без запаздывания (движение по дуге в реальном времени).
 * Если цель прыгнула (сменили тему), светило не едет через всё небо: гаснет и проявляется на новом месте.
 */
function trackBody(cur: number[], tg: number[], fading: { on: boolean }, dt: number) {
  const jump = Math.hypot(tg[0] - cur[0], tg[1] - cur[1]) > 0.03;
  if (jump && cur[2] > 0.02) fading.on = true;
  if (fading.on) {
    cur[2] += (0 - cur[2]) * follow(5, dt);
    if (cur[2] < 0.02) { cur[0] = tg[0]; cur[1] = tg[1]; fading.on = false; }
  } else {
    cur[0] = tg[0]; cur[1] = tg[1];
    cur[2] += (tg[2] - cur[2]) * follow(2.5, dt);
  }
  cur[3] += (tg[3] - cur[3]) * follow(2, dt);
}
const lerp3 = (a: V3, b: V3, k: number) => { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k; };

/**
 * Живой фон — море дельты под настоящим небом. В «Авто» солнце и луна идут по своим дугам
 * в реальном времени (МСК), небо и вода плавно перетекают: ночь → сумерки → золотой час → день.
 * При движении мыши по воде бежит свет за курсором; клик пускает волну. Режим подкрашивает море
 * (настороженность — янтарь, тревога — красный) и ускоряет волны.
 * Без видеокарты или при «уменьшить движение» — тихий запасной фон.
 */
export default function Ambient({ mode, quiet = false, moon = 0.5 }: { mode: Mode; quiet?: boolean; moon?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, quiet, moon });
  const pulse = useRef<{ x: number; y: number; t0: number; k: number } | null>(null);
  live.current = { mode, quiet, moon };

  useEffect(() => {
    if (mode === 'alarm' || mode === 'alertness') pulse.current = { x: 0.5, y: 0.35, t0: performance.now(), k: mode === 'alarm' ? 1 : 0.6 };
  }, [mode]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const force = new URLSearchParams(location.search).has('sea');   // для проверки на машине без видеокарты
    let sea: ReturnType<typeof createSea> = null;
    try { sea = reducedMotion() ? null : createSea(cv, force); } catch { sea = null; }
    if (!sea) { cv.style.display = 'none'; return; }
    cv.parentElement?.classList.add('has-water');
    const gfx = sea;

    let w = 0, h = 0, raf = 0, prev = 0, slow = 0, quietAt = 0;
    const startAt = performance.now();
    const t0 = targets(live.current.mode, live.current.moon);
    const copy = (c: V3) => [...c] as V3;
    const f: Frame & { speed: number } = {
      t: 0, ptr: [0.5, 0.5], power: 0, gain: 0, pulse: [0, 0, 0, 0], speed: 1,
      pal: { ...t0.pal, top: copy(t0.pal.top), hz: copy(t0.pal.hz), far: copy(t0.pal.far), near: copy(t0.pal.near), line: copy(t0.pal.line), isle: copy(t0.pal.isle), sun: copy(t0.pal.sun) },
      moonC: copy(t0.moonC), sun: [...t0.sun], moon: [...t0.moon],
    };
    const fadeSun = { on: false }, fadeMoon = { on: false };
    const ptr = { tx: 0.5, ty: 0.5, moved: -1e9 };

    const resize = () => { w = innerWidth; h = innerHeight; gfx.resize(w, h); };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { prev = 0; return; }
      const { mode: m, quiet: q, moon: mp } = live.current;
      if (q && now - quietAt < 80) return;              // на карте фон почти закрыт — 12 кадров в секунду
      quietAt = now;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 1 / 60;
      prev = now;

      f.speed += (SPEED[m] - f.speed) * follow(0.6, dt);
      f.t += dt * f.speed;
      // цвета неба и воды мягко идут к цели (смена режима и темы); светила — точно по дуге
      const tg = targets(m, mp);
      const kc = follow(1.2, dt);
      (['top', 'hz', 'far', 'near', 'line', 'isle', 'sun'] as const).forEach((n) => lerp3(f.pal[n], tg.pal[n], kc));
      lerp3(f.moonC, tg.moonC, kc);
      f.pal.stars += (tg.pal.stars - f.pal.stars) * kc;
      f.pal.clouds += (tg.pal.clouds - f.pal.clouds) * kc;
      trackBody(f.sun, tg.sun, fadeSun, dt);
      trackBody(f.moon, tg.moon, fadeMoon, dt);
      // свет за курсором — только пока мышь двигается
      const moving = now - ptr.moved < 2200;
      const k = follow(4, dt);
      f.ptr[0] += (ptr.tx - f.ptr[0]) * k;
      f.ptr[1] += (ptr.ty - f.ptr[1]) * k;
      f.power += ((moving ? 1 : 0) - f.power) * follow(2, dt);
      const a = Math.min(1, (now - startAt) / 1800);
      f.gain = 1 - (1 - a) ** 3;
      const p = pulse.current;
      if (p) {
        const age = (now - p.t0) / 1000;
        if (age > 3.5) pulse.current = null;
        f.pulse = [p.x, p.y, age, p.k];
      } else f.pulse = [0, 0, 0, 0];
      gfx.draw(f);

      if (!q) { slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 1); if (slow > 90) { gfx.lower(w, h); slow = -1e9; } }
    };

    const onMove = (e: PointerEvent) => { ptr.tx = e.clientX / innerWidth; ptr.ty = e.clientY / innerHeight; ptr.moved = performance.now(); };
    const onDown = (e: PointerEvent) => {
      if (live.current.quiet) return;
      pulse.current = { x: e.clientX / innerWidth, y: 1 - e.clientY / innerHeight, t0: performance.now(), k: 0.7 };
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
      <div className="mist" />
      <Reeds side="left" seed={5} count={13} className="reeds reeds-left" />
      <Reeds side="right" seed={17} count={13} className="reeds reeds-right" />
    </div>
  );
}
