import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';
import Reeds from './Reeds';
import { currentSky } from '../theme';

import { hex, palAt, type Pal, type V3 } from '../skyPalette';

/** Режим подкрашивает море: настороженность — янтарём, тревога — красным */
const TINT: Record<Mode, { c: V3; k: number }> = {
  calm: { c: [0, 0, 0], k: 0 }, alertness: { c: hex('#F59E0B'), k: 0.14 }, alarm: { c: hex('#EF4444'), k: 0.2 }, intercept: { c: hex('#EF4444'), k: 0.16 },
};
const SPEED: Record<Mode, number> = { calm: 1, alertness: 1.2, alarm: 1.55, intercept: 1.4 };

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// Мультяшное море: небо ровными полосами, звёзды-искорки, плоские облака, солнце и луна — диски
// с кольцами-ореолами (луна — в фазе), острова-силуэты. Вода — плоские слои глубины, ленты зыби
// и раскиданные значки волн «~», под светилом — мигающая дорожка из черточек. Клик — контурные круги.
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;uniform float uGain;uniform vec4 uPulse;
uniform vec3 uTop;uniform vec3 uHz;uniform vec3 uFar;uniform vec3 uNear;uniform vec3 uLine;uniform vec3 uIsle;uniform vec3 uSunC;
uniform vec4 uSun;uniform vec4 uMoon;uniform float uStars;uniform float uClouds;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
const float HZ=.8;
vec2 plane(vec2 uv,float asp){float below=max(HZ-uv.y,.001);float d=1./(below+.06);return vec2((uv.x-.5)*asp*d*.35,d);}
float cloud(vec2 p,float s){        // облако — несколько кругов
  float c=length(p-vec2(-.9,0.)*s)-.55*s;
  c=min(c,length(p-vec2(-.25,.25)*s)-.75*s);
  c=min(c,length(p-vec2(.5,.12)*s)-.62*s);
  c=min(c,length(p-vec2(1.05,-.05)*s)-.42*s);
  return max(c,-p.y-.25*s);          // плоское дно
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float px=1.5/uRes.y;
  float below=HZ-uv.y;
  vec3 col;
  if(below<0.){
    // ---- небо: четыре ровные полосы от горизонта к зениту ----
    float a=clamp(-below/(1.-HZ),0.,1.);
    col=mix(uHz,uTop,floor(pow(a,.75)*4.)/3.);
    // звёзды-искорки с четырьмя лучами, мигают ступенькой
    vec2 sp=vec2(uv.x*asp,uv.y)*55.;vec2 cell=floor(sp);float h=hash(cell);
    if(h>.86){
      vec2 f=fract(sp)-.5-(vec2(hash(cell+3.1),hash(cell+7.7))-.5)*.5;
      float sz=.12+.18*hash(cell+1.3);
      float star=max(smoothstep(.05,.0,abs(f.y))*smoothstep(sz,0.,abs(f.x)),smoothstep(.05,.0,abs(f.x))*smoothstep(sz,0.,abs(f.y)));
      star=max(star,smoothstep(.07,.03,length(f)));
      float blink=step(.25,fract(uT*(.15+h*.2)+h*9.));
      col=mix(col,vec3(1.,.98,.9),star*blink*uStars*smoothstep(0.,.06,a));
    }
    // облака: плоская заливка и ровная тень снизу
    for(int i=0;i<3;i++){
      float fi=float(i);
      vec2 c=vec2(fract(.15+fi*.37+uT*.0035*(1.+fi*.3))*1.4-.2,HZ+.06+.05*fi);
      vec2 q=(uv-c)*vec2(asp,1.);
      float d=cloud(q,.028+.006*fi);
      float body=smoothstep(px,-px,d);
      vec3 cc=mix(vec3(1.),uHz,.25);
      cc=mix(cc,cc*mix(uHz,vec3(.8),.4),smoothstep(.006,-.004,q.y+.006)*.5);
      col=mix(col,cc,body*uClouds);
    }
    // солнце: диск и два плоских кольца-ореола
    vec2 ds=(uv-uSun.xy)*vec2(asp,1.);float rs=length(ds);float R=uSun.w;
    float sun=max(smoothstep(R+px,R-px,rs),max(smoothstep(R*1.7+px,R*1.7-px,rs)*.28,smoothstep(R*2.6+px,R*2.6-px,rs)*.12));
    col=mix(col,uSunC,sun*uSun.z);
    // луна: диск в фазе (тень — сдвинутый диск), пепельный край и ореол
    vec2 dm=(uv-uMoon.xy)*vec2(asp,1.);float rm=length(dm);float Rm=.022;
    float disc=smoothstep(Rm+px,Rm-px,rm);
    float ph=abs(uMoon.w),side=uMoon.w<0.?-1.:1.;
    float shade=smoothstep(Rm+px,Rm-px,length(dm+vec2(side*2.*Rm*ph,0.)));
    vec3 moonC=vec3(.95,.96,1.);
    col=mix(col,mix(col,moonC,.12),smoothstep(Rm*1.8+px,Rm*1.8-px,rm)*uMoon.z);   // ореол
    col=mix(col,col*.7+moonC*.12,disc*uMoon.z);                                    // пепельный свет
    col=mix(col,moonC,disc*(1.-shade)*uMoon.z);
  }else{
    // ---- вода: плоские слои глубины ----
    vec2 w=plane(uv,asp);
    float t=uT;
    float depth=clamp(below/HZ,0.,1.);
    col=mix(uFar,uNear,floor(pow(depth,.5)*4.)/3.);
    // ленты зыби катятся к зрителю
    float sw=sin(w.y*1.4-t*.7+sin(w.x*.3+t*.15)*1.4);
    col=mix(col,mix(col,uLine,.12),step(.86,sw)*smoothstep(.02,.12,depth));
    // значки волн «~» — не в каждой клетке, покачиваются
    vec2 cs=vec2(2.4,1.1);
    vec2 g=w/cs;vec2 id=floor(g);vec2 f=fract(g)-.5;
    float hs=hash(id);
    float dpx=(1./uRes.y)/((below+.06)*(below+.06))/cs.y;           // пиксель в долях клетки
    if(hs>.5){
      vec2 c=vec2((hash(id+1.7)-.5)*.4+.1*sin(t*.8+hs*30.),(hash(id+4.1)-.5)*.3);
      vec2 q=f-c;
      float L=.16+.08*hash(id+9.);
      float y=.07*sin(q.x/L*6.2832);
      float lw=max(.035,dpx*1.3);
      float mark=smoothstep(lw,lw*.35,abs(q.y-y))*smoothstep(L,L*.75,abs(q.x));
      col=mix(col,uLine,mark*.55*smoothstep(.04,.2,depth));
    }
    // дорожка под светилом и под курсором: мигающие черточки, к зрителю шире
    float row=floor(w.y/.45);
    float fy=fract(w.y/.45);
    float bar=smoothstep(.0,.06,fy)*smoothstep(.26,.18,fy);
    float sunUp=uSun.z;float moonUp=uMoon.z*.8;
    float bx=mix(uMoon.x,uSun.x,step(moonUp,sunUp));
    float bright=max(sunUp,moonUp);
    float lx=(uv.x-bx)*asp/mix(.02,.33,depth);
    float hw=.3+.7*hash(vec2(row,3.));
    float on=step(.35,hash(vec2(row,floor(t*1.6+hash(vec2(row,1.))*7.))));
    col=mix(col,uSunC,bar*smoothstep(hw,hw*.8,abs(lx+.25*(hash(vec2(row,5.))-.5)))*on*bright*.9);
    float lp=(uv.x-uPtr.x)*asp/mix(.02,.28,depth);
    col=mix(col,uLine,bar*smoothstep(hw*.8,hw*.6,abs(lp))*on*uPower*.35);
    // круги по воде: клик и тревога — ровные контурные кольца
    if(uPulse.w>0.){
      vec2 pc=plane(vec2(uPulse.x,uPulse.y),asp);
      float dw=distance(w*vec2(1.,.55),pc*vec2(1.,.55));
      float lwr=max(.05,dpx*cs.y*1.5);
      float r1=uPulse.z*1.6,r2=uPulse.z*1.1;
      float ring=max(smoothstep(lwr,0.,abs(dw-r1)),smoothstep(lwr,0.,abs(dw-r2))*.6);
      col=mix(col,uLine,ring*exp(-uPulse.z*1.1)*uPulse.w*.8);
    }
  }
  // острова дельты на горизонте — плоские силуэты и их отражение
  float hx=uv.x*asp;
  float isle=step(.52,noise(vec2(hx*2.2,4.1)));
  float ih=(.004+.012*noise(vec2(hx*14.,1.7)))*isle;
  float a2=uv.y-HZ;
  col=mix(col,uIsle,smoothstep(ih+px*.5,ih-px*.5,a2)*step(0.,a2)*isle);
  col=mix(col,mix(col,uIsle,.45),smoothstep(ih*.7+px*.5,ih*.7-px*.5,-a2)*step(0.,-a2)*isle);
  col=mix(col,mix(uHz,vec3(1.),.35),smoothstep(px,0.,abs(a2))*(1.-isle)*.6);   // чёткая линия горизонта
  gl_FragColor=vec4(col*uGain,1.);
}`;

/** Доля пути к цели за кадр — одинаковая плавность на 60 и на 144 Гц. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

interface Frame {
  t: number; ptr: number[]; power: number; gain: number; pulse: number[];
  pal: Pal; sun: number[]; moon: number[];
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
  const names = ['uRes', 'uT', 'uPtr', 'uPower', 'uGain', 'uPulse', 'uTop', 'uHz', 'uFar', 'uNear', 'uLine', 'uIsle', 'uSunC', 'uSun', 'uMoon', 'uStars', 'uClouds'];
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
  let scale = 0.6;   // ровные цвета мультяшного моря терпят пониженное разрешение
  return {
    resize(w: number, h: number) {
      canvas.width = Math.max(2, Math.round(Math.min(w, 2200) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w: number, h: number) { scale = 0.35; this.resize(w, h); },
    draw(f: Frame) {
      const v3 = (n: string, c: V3) => gl.uniform3f(u[n], c[0], c[1], c[2]);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uT, f.t);
      gl.uniform2f(u.uPtr, f.ptr[0], f.ptr[1]);
      gl.uniform1f(u.uPower, f.power);
      gl.uniform1f(u.uGain, f.gain);
      gl.uniform4f(u.uPulse, f.pulse[0], f.pulse[1], f.pulse[2], f.pulse[3]);
      v3('uTop', f.pal.top); v3('uHz', f.pal.hz); v3('uFar', f.pal.far); v3('uNear', f.pal.near);
      v3('uLine', f.pal.line); v3('uIsle', f.pal.isle); v3('uSunC', f.pal.sun);
      gl.uniform4f(u.uSun, f.sun[0], f.sun[1], f.sun[2], f.sun[3]);
      gl.uniform4f(u.uMoon, f.moon[0], f.moon[1], f.moon[2], f.moon[3]);
      gl.uniform1f(u.uStars, f.pal.stars);
      gl.uniform1f(u.uClouds, f.pal.clouds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/** Цели кадра из неба темы и режима: палитра по высоте солнца, подкраска режимом, светила */
function targets(mode: Mode, moonProp: number) {
  const sky = currentSky();
  const base = palAt(sky.sunAlt);
  const tint = TINT[mode];
  const tn = (c: V3, k: number) => c.map((v, i) => v + (tint.c[i] - v) * tint.k * k) as V3;
  const pal: Pal = { ...base, far: tn(base.far, 1), near: tn(base.near, 0.6), hz: tn(base.hz, 0.5), line: tn(base.line, 0.4) };
  const illum = sky.moon.illum >= 0 ? sky.moon.illum : moonProp;          // «Ночь»/«День» — фаза из прогноза
  const phase = (sky.moon.waxing ? 1 : -1) * Math.max(0.001, illum);
  return {
    pal,
    sun: [sky.sun.x, sky.sun.y, sky.sun.visible, 0.026],
    moon: [sky.moon.x, sky.moon.y, sky.moon.visible, phase],
  };
}
const lerp3 = (a: V3, b: V3, k: number) => { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k; };

/**
 * Живой фон — мультяшное море дельты под настоящим небом: в «Авто» солнце и луна стоят там,
 * где они сейчас над дельтой (время — МСК), небо и вода перетекают от ночи к сумеркам, золотому
 * часу и дню. Звёзды-искорки, плоские облака, острова, камыш по краям, туман над горизонтом.
 * При движении мыши по воде бегут черточки света за курсором; клик пускает круги. Режим подкрашивает
 * море (настороженность — янтарь, тревога — красный) и ускоряет волны.
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
    const f: Frame & { speed: number } = {
      t: 0, ptr: [0.5, 0.5], power: 0, gain: 0, pulse: [0, 0, 0, 0], speed: 1,
      pal: { ...t0.pal, top: [...t0.pal.top], hz: [...t0.pal.hz], far: [...t0.pal.far], near: [...t0.pal.near], line: [...t0.pal.line], isle: [...t0.pal.isle], sun: [...t0.pal.sun] },
      sun: [...t0.sun], moon: [...t0.moon],
    };
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
      // небо и вода плавно идут к цели (смена темы, режима, сдвиг солнца раз в минуту)
      const tg = targets(m, mp);
      const kc = follow(1.2, dt);
      (['top', 'hz', 'far', 'near', 'line', 'isle', 'sun'] as const).forEach((n) => lerp3(f.pal[n], tg.pal[n], kc));
      f.pal.stars += (tg.pal.stars - f.pal.stars) * kc;
      f.pal.clouds += (tg.pal.clouds - f.pal.clouds) * kc;
      for (let i = 0; i < 4; i++) { f.sun[i] += (tg.sun[i] - f.sun[i]) * kc; f.moon[i] += (tg.moon[i] - f.moon[i]) * kc; }
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
