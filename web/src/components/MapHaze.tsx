import { useEffect, useRef, useSyncExternalStore } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { Buoy } from '../types';
import { introCovering } from '../introBus';
import { currentTheme } from '../theme';
import { reducedMotion } from '../motion';

/**
 * Живая дымка над картой — плавная, как дымка на прошлом сайте команды, но про воду.
 * Четыре варианта (выбор запоминается, показать переключатель — ?haze в адресе):
 *   1 «Туман над водой» — переливающийся туман медленно тянется к морю, расступается у курсора;
 *   2 «Течение»         — тонкие шёлковые струи вытянуты вдоль течения дельты и плывут к морю;
 *   3 «Сияние глубины»  — большие мягкие пятна цвета неспешно перетекают друг в друга;
 *   4 «Дыхание буёв»    — от каждого буя поднимается и тает дымка, у буя с тревогой — красная.
 * Клик по карте пускает по дымке волну. Один холст WebGL, полразрешения, 30 кадров в секунду.
 */
export const HAZES = [
  { id: 1, name: 'Туман над водой' },
  { id: 2, name: 'Течение' },
  { id: 3, name: 'Сияние глубины' },
  { id: 4, name: 'Дыхание буёв' },
] as const;

const KEY = '404-haze';
const subs = new Set<() => void>();
let variant = (() => {
  try {
    const q = new URLSearchParams(location.search).get('haze');
    if (q && /^[0-4]$/.test(q)) localStorage.setItem(KEY, q);
    const v = Number(localStorage.getItem(KEY));
    return v >= 0 && v <= 4 ? v : 1;
  } catch { return 1; }
})();
/** Переключатель вариантов виден, если в адресе есть ?haze */
export const hazePicker = (() => { try { return new URLSearchParams(location.search).has('haze'); } catch { return false; } })();
export function setHaze(v: number) {
  variant = v;
  try { localStorage.setItem(KEY, String(v)); } catch { /* только на эту вкладку */ }
  subs.forEach((f) => f());
}
export const useHaze = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => variant);

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;uniform vec4 uPulse;
uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;uniform float uV;uniform float uGain;uniform vec4 uBuoy[12];uniform float uGlow;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<3;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 asp=vec2(uRes.x/uRes.y,1.);
  float d=distance(uv*asp,uPtr*asp);
  float t=uT;
  vec3 col=uA;float a=0.;
  if(uV<1.5){
    // туман: двойное искажение шума, тянется к морю (вниз-вправо), у курсора расступается
    vec2 p=uv*asp*1.5+vec2(-t*.02,t*.012);
    p-=(uPtr-uv)*asp*.5*exp(-d*d*6.)*uPower;
    float tt=t*.08;
    vec2 q=vec2(fbm(p+vec2(0.,tt)),fbm(p+vec2(5.2,1.3)-tt*.8));
    vec2 r=vec2(fbm(p+2.6*q+vec2(1.7,9.2)+tt*1.1),fbm(p+2.6*q+vec2(8.3,2.8)-tt*.7));
    float f=fbm(p+3.2*r);
    col=mix(uC,uA,clamp(r.x*1.4-.1,0.,1.));
    col=mix(col,uB,smoothstep(.55,.8,q.y)*.6);
    a=smoothstep(.34,.82,f)*.62;
  }else if(uV<2.5){
    // течение: поле вытянуто вдоль дельты, шёлковые струи плывут к морю
    vec2 s=mat2(.82,-.57,.57,.82)*(uv*asp);
    s.x*=.38;
    s+=vec2(-t*.05,0.);
    vec2 q=vec2(fbm(s*3.+vec2(0.,t*.06)),fbm(s*3.+vec2(3.1,7.)+t*.05));
    float f=fbm(s*3.4+q*2.2);
    float fil=0.;
    for(int k=0;k<4;k++){float c=.38+float(k)*.09;fil+=(1.-smoothstep(0.,.022,abs(f-c)))*(1.-float(k)*.18);}
    col=mix(uC,uA,clamp(q.x*1.4-.1,0.,1.));
    a=fil*.36+smoothstep(.45,.8,f)*.14;
    a*=1.-.7*exp(-d*d*12.)*uPower;
  }else if(uV<3.5){
    // сияние: три больших мягких пятна цвета медленно перетекают
    vec2 p=uv*asp;
    vec2 c1=vec2(.28+.12*sin(t*.07),.62+.14*sin(t*.05+1.))*asp,c2=vec2(.66+.14*sin(t*.06+2.),.34+.14*sin(t*.08+.5))*asp,c3=vec2(.5+.18*sin(t*.045+4.),.82+.1*sin(t*.07+3.))*asp;
    float w=(fbm(p*1.6+t*.04)-.5)*.3;
    float g1=exp(-pow(distance(p,c1)+w,2.)*7.),g2=exp(-pow(distance(p,c2)-w,2.)*6.),g3=exp(-pow(distance(p,c3)+w*.5,2.)*9.);
    float gp=exp(-d*d*10.)*uPower;
    float s=g1+g2+g3+gp*.7+1e-3;
    col=(uA*g1+uB*g2*1.1+uC*g3+uA*gp*.7)/s;
    a=smoothstep(.1,1.4,s)*.34;
  }else{
    // дыхание буёв: над каждым поднимаются клубы и тают, у буя с тревогой — красные и чаще
    vec2 wp=uv*asp*7.+vec2(-t*.1,-t*.25);
    vec2 warp=(vec2(fbm(wp),fbm(wp+4.3))-.5)*.05;
    float dens=0.;vec3 acc=vec3(0.);
    for(int i=0;i<12;i++){
      vec4 b=uBuoy[i];
      if(b.z>.5){
        float alarm=step(1.5,b.z);
        for(int j=0;j<3;j++){
          float ph=fract(t*(.07+alarm*.1)+float(j)/3.+float(i)*.137);
          vec2 c=b.xy+vec2(.015*sin(t*.4+float(i)+ph*3.),ph*.12);
          vec2 rel=(uv+warp-c)*asp;
          float rad=.014+ph*.04;
          float pl=exp(-dot(rel,rel)/(rad*rad))*(1.-ph)*smoothstep(0.,.18,ph);
          acc+=mix(uA,vec3(.96,.38,.38),alarm)*pl;
          dens+=pl;
        }
      }
    }
    col=acc/max(dens,1e-3);
    a=clamp(dens*.45,0.,.42);
  }
  // свет у курсора и волна от клика — во всех вариантах
  float glow=exp(-d*d*16.)*.16*uPower;
  float ring=0.;
  if(uPulse.w>0.){float pd=distance(uv*asp,uPulse.xy*asp);float w=(pd-uPulse.z*.55)*9.;ring=exp(-w*w)*exp(-uPulse.z*1.6)*uPulse.w;}
  col=mix(col,uA,clamp(glow*2.+ring,0.,1.));
  a=clamp(a+glow+ring*.45,0.,.85)*uGain;
  a+=(hash(gl_FragCoord.xy+fract(uT))-.5)/160.*step(.003,a);
  a=max(a,0.);
  // ночью дымка светится (добавляет свет, а не серую пелену), днём — светлый туман
  gl_FragColor=vec4(col*a,a*mix(1.,.45,uGlow));
}`;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const NIGHT = { a: hex('#8EC2E6'), b: hex('#A7B79A'), c: hex('#3F6FA8'), gain: 1, glow: 1 };
const DAY = { a: hex('#FFFFFF'), b: hex('#EEF4E8'), c: hex('#D6E6F2'), gain: 0.8, glow: 0 };

export default function MapHaze({ buoys }: { buoys: Buoy[] }) {
  const map = useMap();
  const v = useHaze();
  const live = useRef({ buoys, v });
  live.current = { buoys, v };

  useEffect(() => {
    if (reducedMotion()) return;
    const cv = document.createElement('canvas');
    cv.className = 'map-haze';
    cv.setAttribute('aria-hidden', 'true');
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '440', opacity: '0', transition: 'opacity 1.2s ease' });
    const host = map.getContainer();
    host.appendChild(cv);
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) { cv.remove(); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('404: дымка не собралась'); cv.remove(); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = { glow: U('uGlow'), res: U('uRes'), t: U('uT'), ptr: U('uPtr'), power: U('uPower'), pulse: U('uPulse'), a: U('uA'), b: U('uB'), c: U('uC'), v: U('uV'), gain: U('uGain'), buoy: U('uBuoy') };
    const scale = 0.5;
    let w = 0, h = 0, raf = 0, last = 0, power = 0, moved = -1e9;
    const ptr = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    let pulse: { x: number; y: number; t0: number } | null = null;
    const buoyData = new Float32Array(48);
    const size = () => {
      const s = map.getSize();
      w = s.x; h = s.y;
      cv.width = Math.max(2, Math.round(w * scale)); cv.height = Math.max(2, Math.round(h * scale));
      gl.viewport(0, 0, cv.width, cv.height);
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || introCovering() || now - last < 33) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
      last = now;
      const { v: variant, buoys: bs } = live.current;
      cv.style.opacity = variant ? '1' : '0';
      if (!variant) return;
      const P = currentTheme() === 'day' ? DAY : NIGHT;
      const k = 1 - Math.exp(-6 * dt);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
      power += ((now - moved < 1800 ? 1 : 0) - power) * (1 - Math.exp(-2.5 * dt));
      buoyData.fill(0);
      bs.slice(0, 12).forEach((b, i) => {
        if (b.status === 'offline') return;
        const p = map.latLngToContainerPoint(L.latLng(b.lat, b.lon));
        buoyData.set([p.x / w, 1 - p.y / h, b.status === 'alert' ? 2 : 1, 0], i * 4);
      });
      gl.uniform2f(u.res, cv.width, cv.height);
      gl.uniform1f(u.t, now / 1000);
      gl.uniform2f(u.ptr, ptr.x, ptr.y);
      gl.uniform1f(u.power, power);
      const age = pulse ? (now - pulse.t0) / 1000 : 0;
      if (pulse && age > 2.6) pulse = null;
      gl.uniform4f(u.pulse, pulse?.x ?? 0, pulse?.y ?? 0, age, pulse ? 1 : 0);
      gl.uniform3fv(u.a, P.a); gl.uniform3fv(u.b, P.b); gl.uniform3fv(u.c, P.c);
      gl.uniform1f(u.v, variant);
      gl.uniform1f(u.gain, P.gain);
      gl.uniform1f(u.glow, P.glow);
      gl.uniform4fv(u.buoy, buoyData);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      ptr.tx = (e.clientX - r.left) / r.width; ptr.ty = 1 - (e.clientY - r.top) / r.height;
      moved = performance.now();
    };
    const onDown = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pulse = { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, t0: performance.now() };
    };
    size();
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerdown', onDown, { passive: true });
    map.on('resize', size);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerdown', onDown);
      map.off('resize', size);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      cv.remove();
    };
  }, [map]);
  return null;
}
