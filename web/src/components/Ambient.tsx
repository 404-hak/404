import { useEffect, useRef } from 'react';
import type { Mode } from '../types';
import { reducedMotion } from '../motion';
import Reeds from './Reeds';

/** Цвета свечения по режиму: светлое течение и глубина. Спокойно — морская синева. */
const COLORS: Record<Mode, { a: [number, number, number]; b: [number, number, number] }> = {
  calm: { a: [0.37, 0.57, 0.7], b: [0.1, 0.2, 0.34] },
  alertness: { a: [0.62, 0.55, 0.4], b: [0.16, 0.2, 0.3] },
  alarm: { a: [0.7, 0.36, 0.36], b: [0.2, 0.13, 0.22] },
  intercept: { a: [0.66, 0.4, 0.38], b: [0.18, 0.14, 0.24] },
};
const SPEED: Record<Mode, number> = { calm: 1, alertness: 1.2, alarm: 1.55, intercept: 1.4 };
/** Луна над горизонтом справа (доли экрана, y — снизу); фаза — из прогноза */
const MOON = { x: 0.84, y: 0.885 };

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// Стилизованное ночное море: мягкая дымка неба и горизонт, вода в перспективе — к горизонту
// всё сжимается, свет ложится вытянутыми мазками, широкие полосы зыби катятся к зрителю,
// под источником света — дорожка из размытых мазков. Течения — как в фоне 404-upk.
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;
uniform vec3 uA;uniform vec3 uB;uniform float uGain;uniform vec4 uPulse;uniform vec3 uMoon;
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
  vec3 deep=uB*.55;
  vec3 haze=uB*1.05+uA*.09;
  vec3 moonC=vec3(.86,.9,.97);
  float shine=.45+.55*uMoon.z;                          // сколько света даёт луна в эту ночь
  // небо: от глубины к светлой дымке у горизонта
  vec3 col=mix(haze,deep*.9,smoothstep(HZ,1.,uv.y));
  float above=uv.y-HZ;
  if(above>0.){
    // звёзды: редкие, мерцают, у горизонта тонут в дымке; при яркой луне их меньше
    vec2 sp=vec2(uv.x*asp,uv.y)*150.;vec2 cell=floor(sp);float h=hash(cell);
    vec2 off=vec2(hash(cell+3.1),hash(cell+7.7))-.5;
    float st=step(.955,h)*smoothstep(.24,0.,length(fract(sp)-.5-off*.55));
    col+=moonC*st*(.45+.55*sin(uT*(.7+h*2.4)+h*60.))*.9*smoothstep(0.,.07,above)*(1.-.4*uMoon.z);
    // луна: пепельный диск, освещённая часть по фазе, ореол
    vec2 d=(uv-uMoon.xy)*vec2(asp,1.);float R=.024,r=length(d);
    float disc=smoothstep(R,R-.003,r);
    float shade=smoothstep(R,R-.003,length(d+vec2(2.*R*uMoon.z,0.)));
    col=mix(col,col*.55+moonC*.1,disc*.6);
    col=mix(col,moonC,disc*(1.-shade)*.95);
    col+=moonC*exp(-r*r/(.002+.012*uMoon.z))*.2*shine;
  }
  if(below>0.){
    vec2 w=plane(uv,asp);
    float t=uT;
    if(uPulse.w>0.){
      vec2 c=plane(vec2(uPulse.x,uPulse.y),asp);
      float r=uPulse.z*1.6;
      float dw=distance(w*vec2(1.,.55),c*vec2(1.,.55));
      float k=(dw-r)*2.2;
      w+=normalize(w-c+1e-4)*sin((dw-r)*9.)*exp(-k*k)*exp(-uPulse.z*1.1)*uPulse.w*.18;
    }
    vec2 q=vec2(fbm(w*.6+vec2(t*.03,0.)),fbm(w*.6+vec2(5.2,1.3)-vec2(0.,t*.02)));
    float f=fbm(w*.6+2.*q+vec2(0.,-t*.05));
    float swell=.5+.5*sin(w.y*2.2-t*.85+f*3.);
    float nearK=mix(2.,1.,clamp((w.y-1.)/5.,0.,1.));        // у зрителя рябь мельче и чаще, не пятнами
    float s1=noise(vec2(w.x*3.,w.y*6.)*nearK+q*2.+vec2(t*.12,-t*.55));
    float streak=smoothstep(.56,.86,s1)*smoothstep(.15,.95,swell);
    float lx=(uv.x-uPtr.x)*asp;
    float wd=mix(.05,.42,clamp(below/HZ,0.,1.));
    float path=exp(-lx*lx/(wd*wd));
    vec3 water=mix(deep,uB*.95,smoothstep(.3,.8,f));
    water+=uA*swell*.05;
    water+=uA*streak*(.09+.42*path*uPower);
    // лунная дорожка: блёстки на мелкой ряби, у горизонта узкая, к зрителю шире
    float lm=(uv.x-uMoon.x)*asp;
    float wm=mix(.02,.34,clamp(below/HZ,0.,1.));
    float mpath=exp(-lm*lm/(wm*wm));
    float g=noise(vec2(w.x*9.,w.y*22.)+q*3.+vec2(t*.3,-t*1.4));
    float glit=pow(smoothstep(.55,1.,g),3.)*smoothstep(.15,.9,swell+.25);
    water+=moonC*mpath*(glit*1.15+.05)*shine;
    water+=mix(uA,moonC,.5)*path*glit*.45*uPower;           // блёстки и под светом от курсора
    // мелкая рябь у зрителя
    float rip=noise(vec2(w.x*7.,w.y*15.)+vec2(t*.2,-t*.9));
    water+=uA*smoothstep(.62,.92,rip)*.05*clamp(below*3.,0.,1.);
    // к горизонту вода тонет в дымке
    col=mix(water,haze,smoothstep(.14,0.,below)*.75);
  }
  col+=uA*exp(-pow((uv.y-HZ)*70.,2.))*.1;                 // светлая кромка горизонта
  // дальние острова дельты на горизонте и их тёмное отражение
  float hx=uv.x*asp;
  float isle=smoothstep(.42,.6,noise(vec2(hx*2.2,4.1)));
  float ih=(.003+.011*fbm(vec2(hx*22.,1.7)))*isle;
  float a2=uv.y-HZ;
  col=mix(col,deep*.72,(1.-smoothstep(ih-.0015,ih,a2))*step(-.0004,a2)*isle*.9);
  col=mix(col,deep*.8,(1.-smoothstep(ih*.8-.0015,ih*.8,-a2))*step(0.,-a2)*isle*.35);
  col*=mix(.7,1.,smoothstep(1.2,.3,distance(uv,vec2(.5,.55))));
  col+=(hash(gl_FragCoord.xy+fract(uT))-.5)/255.;          // против полос на градиенте
  gl_FragColor=vec4(col*uGain,1.);
}`;

/** Доля пути к цели за кадр — одинаковая плавность на 60 и на 144 Гц. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

interface Frame { t: number; ptr: number[]; power: number; a: number[]; b: number[]; gain: number; pulse: number[]; moon: number }

function createGlow(canvas: HTMLCanvasElement, force: boolean) {
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
  const u = Object.fromEntries(['uRes', 'uT', 'uPtr', 'uPower', 'uA', 'uB', 'uGain', 'uPulse', 'uMoon'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  let scale = 0.5;   // свечение мягкое: половины разрешения хватает
  return {
    resize(w: number, h: number) {
      canvas.width = Math.max(2, Math.round(Math.min(w, 2200) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w: number, h: number) { scale = 0.3; this.resize(w, h); },
    draw(f: Frame) {
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uT, f.t);
      gl.uniform2f(u.uPtr, f.ptr[0], f.ptr[1]);
      gl.uniform1f(u.uPower, f.power);
      gl.uniform3f(u.uA, f.a[0], f.a[1], f.a[2]);
      gl.uniform3f(u.uB, f.b[0], f.b[1], f.b[2]);
      gl.uniform1f(u.uGain, f.gain);
      gl.uniform4f(u.uPulse, f.pulse[0], f.pulse[1], f.pulse[2], f.pulse[3]);
      gl.uniform3f(u.uMoon, MOON.x, MOON.y, f.moon);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/**
 * Живой фон — стилизованное ночное море: горизонт в дымке с островами дельты, звёзды и луна
 * в настоящей фазе (по прогнозу), лунная дорожка из блёсток, размытый камыш по краям, туман над водой;
 * свет на воде мягкими мазками,
 * зыбь катится к зрителю, под светом — дорожка. Свет сам бродит, при движении мыши идёт за курсором;
 * клик пускает по воде кольцо. Режим меняет цвет (синева → тёплый → красноватый) и скорость моря.
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
    let glow: ReturnType<typeof createGlow> = null;
    try { glow = reducedMotion() ? null : createGlow(cv, force); } catch { glow = null; }
    if (!glow) { cv.style.display = 'none'; return; }
    cv.parentElement?.classList.add('has-water');
    const gfx = glow;

    let w = 0, h = 0, raf = 0, prev = 0, slow = 0, quietAt = 0;
    const startAt = performance.now();
    const c0 = COLORS[live.current.mode];
    const f: Frame & { speed: number } = { t: 0, ptr: [MOON.x, 0.5], power: 0.55, a: [...c0.a], b: [...c0.b], gain: 0, pulse: [0, 0, 0, 0], speed: 1, moon: live.current.moon };
    const ptr = { tx: 0.5, ty: 0.5, moved: -1e9 };

    const resize = () => { w = innerWidth; h = innerHeight; gfx.resize(w, h); };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { prev = 0; return; }
      const { mode: m, quiet: q } = live.current;
      if (q && now - quietAt < 80) return;              // на карте фон почти закрыт — 12 кадров в секунду
      quietAt = now;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 1 / 60;
      prev = now;

      f.speed += (SPEED[m] - f.speed) * follow(0.6, dt);
      f.t += dt * f.speed;
      const c = COLORS[m];
      for (let k = 0; k < 3; k++) {
        f.a[k] += (c.a[k] - f.a[k]) * follow(1.1, dt);
        f.b[k] += (c.b[k] - f.b[k]) * follow(1.1, dt);
      }
      // свет: при движении мыши идёт за курсором, в покое сам медленно бродит по экрану
      const moving = now - ptr.moved < 2200;
      const s = now / 1000;
      const tx = moving ? ptr.tx : MOON.x + 0.04 * Math.sin(s * 0.07);   // в покое свет — от луны
      const ty = moving ? ptr.ty : 0.5 + 0.2 * Math.sin(s * 0.053 + 1.3);
      const k = follow(moving ? 4 : 0.8, dt);
      f.ptr[0] += (tx - f.ptr[0]) * k;
      f.ptr[1] += (ty - f.ptr[1]) * k;
      f.power += ((moving ? 1 : 0.6) - f.power) * follow(2, dt);
      f.moon += (live.current.moon - f.moon) * follow(1.5, dt);
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
