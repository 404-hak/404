import type { Mode } from './types';
import { currentSky, liveAt, skyBodies } from './theme';
import { hex, palAt, type Pal, type V3 } from './skyPalette';

/**
 * Море дельты — один рисовальщик для фона сайта и для интро: одно небо, одна вода, одни светила.
 * Интро отличается только ракурсом (горизонт ниже, светила крупнее) и бликом объектива.
 */

/** Режим подкрашивает море: настороженность — янтарём, тревога — красным */
export const TINT: Record<Mode, { c: V3; k: number }> = {
  calm: { c: [0, 0, 0], k: 0 }, alertness: { c: hex('#F59E0B'), k: 0.12 }, alarm: { c: hex('#EF4444'), k: 0.18 }, intercept: { c: hex('#EF4444'), k: 0.14 },
};
export const SPEED: Record<Mode, number> = { calm: 1, alertness: 1.2, alarm: 1.55, intercept: 1.4 };
/** Огоньки буёв сети: спокойно — шалфей, настороженность — янтарь, тревога — красный */
const BEACON: Record<Mode, V3> = { calm: hex('#D2E4BF'), alertness: hex('#FFC46E'), alarm: hex('#FF6C5E'), intercept: hex('#FF6C5E') };

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// Своя стилистика — между реализмом и графикой, всё плавное: небо мягким градиентом, мягкое свечение
// солнца и луны (луна в фазе), звёзды-точки, слоистые облака у горизонта, острова в дымке.
// Вода — течения и зыбь, свет мягкими мазками, под светилом переливается дорожка, по воде бегут
// тёмные пятна ряби от порывов ветра. Почерк 404 — изобаты: тонкие плавные линии, как на морской
// карте и экране сонара. Вдали качаются буи сети с «дышащими» огоньками, днём над водой планируют чайки.
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;uniform float uGain;uniform vec4 uPulse;
uniform vec3 uTop;uniform vec3 uHz;uniform vec3 uFar;uniform vec3 uNear;uniform vec3 uLine;uniform vec3 uIsle;
uniform vec3 uSunC;uniform vec3 uMoonC;uniform vec4 uSun;uniform vec4 uMoon;uniform float uStars;uniform float uClouds;
uniform float uHzY;uniform float uBodyK;uniform float uFlare;uniform float uDark;uniform vec3 uBeacon;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<3;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
vec2 plane(vec2 uv,float asp){float below=max(uHzY-uv.y,.001);float d=1./(below+.06);return vec2((uv.x-.5)*asp*d*.35,d);}
// блик объектива: тонкий горизонтальный луч через светило и мягкое рассеяние вдоль него
vec3 flare(vec2 uv,vec2 L,float asp,vec3 c){
  vec2 p=(uv-L)*vec2(asp,1.);
  float ax=abs(p.x);
  return c*(exp(-p.y*p.y*9000.)*exp(-ax*3.)*.36+exp(-p.y*p.y*700.)*exp(-ax*5.)*.1);
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float HZ=uHzY;
  float below=HZ-uv.y;
  float px=1./uRes.y;
  vec2 ds=(uv-uSun.xy)*vec2(asp,1.);float rs0=length(ds),rs=rs0/uBodyK;      // ореол — как на фоне, диск — по ракурсу
  vec2 dm=(uv-uMoon.xy)*vec2(asp,1.)/uBodyK;float rm=length(dm),rm0=rm*uBodyK;
  float moonLight=uMoon.z*(.3+.7*abs(uMoon.w));
  vec3 col;
  if(below<0.){
    // ---- небо: мягкий градиент, свечение светил ----
    float a=clamp(-below/(1.-HZ),0.,1.);
    col=mix(uHz,uTop,smoothstep(0.,1.,pow(a,.7)));
    col+=uSunC*(exp(-rs0*rs0*14.)*.28+exp(-rs0*rs0*160.)*.32)*uSun.z;
    col+=uMoonC*(exp(-rm0*rm0*60.)*.07+exp(-rm0*rm0*600.)*.1)*moonLight;
    // звёзды — мягкие точки, медленно мерцают; у горизонта тонут в дымке
    vec2 sp=vec2(uv.x*asp,uv.y)*140.;vec2 cell=floor(sp);float h=hash(cell);
    vec2 off=vec2(hash(cell+3.1),hash(cell+7.7))-.5;
    float st=step(.962,h)*smoothstep(.3,0.,length(fract(sp)-.5-off*.55));
    col+=vec3(.9,.93,1.)*st*(.55+.45*sin(uT*(.4+h*1.2)+h*60.))*.8*uStars*smoothstep(0.,.07,a);
    // слоистые облака у горизонта — вытянутые, мягкие, подсвечены светилом
    float cloud=0.;
    if(a<.85&&uClouds>0.){float cl=fbm(vec2(uv.x*asp*1.3+uT*.005,uv.y*11.));cloud=smoothstep(.52,.78,cl)*smoothstep(0.,.12,a)*smoothstep(.85,.3,a)*uClouds;}
    vec3 cc=mix(uHz,uTop,.35)*1.06+uSunC*.12*uSun.z+uMoonC*.04*moonLight;
    col=mix(col,cc,cloud*.5);
    // солнце — мягкий диск
    col=mix(col,uSunC,smoothstep(uSun.w,uSun.w*.72,rs)*uSun.z);
    // луна — мягкий диск в фазе: тень — сдвинутый диск с размытым краем, пепельный свет
    float R=.021;
    float disc=smoothstep(R,R*.84,rm);
    float ph=abs(uMoon.w),side=uMoon.w<0.?-1.:1.;
    float shade=smoothstep(R*1.04,R*.74,length(dm+vec2(side*2.*R*ph,0.)));
    col=mix(col,col*.8+uMoonC*.05,disc*uMoon.z*uStars);                      // тёмная часть видна только ночью
    col=mix(col,uMoonC,disc*(1.-shade)*uMoon.z);
  }else{
    // ---- вода ----
    vec2 w=plane(uv,asp);
    float t=uT;
    float ring=0.;
    if(uPulse.w>0.){                                       // клик, тревога, удар поплавка — мягкая волна по воде
      vec2 c=plane(vec2(uPulse.x,uPulse.y),asp);
      float r=uPulse.z*1.6;
      float dw=distance(w*vec2(1.,.55),c*vec2(1.,.55));
      float k=(dw-r)*2.2;
      ring=exp(-k*k)*exp(-uPulse.z*1.1)*uPulse.w;
      w+=normalize(w-c+1e-4)*sin((dw-r)*9.)*ring*.18;
    }
    vec2 q=vec2(fbm(w*.6+vec2(t*.03,0.)),noise(w*.9+vec2(5.2,1.3)-vec2(0.,t*.02)));
    float f=fbm(w*.6+2.*q+vec2(0.,-t*.05));
    float depth=clamp(below/HZ,0.,1.);
    vec3 water=mix(uFar,uNear,smoothstep(0.,1.,pow(depth,.5)));
    water=mix(water,water*1.1+uLine*.02,smoothstep(.35,.8,f)*.6);          // течения
    // порывы ветра: по воде медленно бегут тёмные пятна мелкой ряби
    float gust=noise(w*vec2(.5,.85)+vec2(-t*.08,t*.025)+3.7);
    float cat=smoothstep(.6,.85,gust)*smoothstep(.02,.2,depth);
    water=mix(water,water*.88,cat*.5);
    float swell=.5+.5*sin(w.y*2.2-t*.85+f*3.);
    water+=uLine*swell*.025;
    // изобаты: тонкие плавные линии на воде, огибают течения
    float iso=fract(w.y*.55+f*1.4+sin(w.x*.22+t*.08)*.5);
    float lw=max(.06,(1.5/uRes.y)/((below+.06)*(below+.06))*.55*1.5);
    water+=uLine*(1.-smoothstep(0.,lw,abs(iso-.5)))*.07*smoothstep(.04,.3,depth)*(1.-cat*.4);
    // мазки света на ряби; в пятнах ветра рябь мельче и чаще
    float nearK=mix(2.,1.,clamp((w.y-1.)/5.,0.,1.));
    float s1=noise(vec2(w.x*3.,w.y*6.)*nearK+q*2.+vec2(t*.12,-t*.55));
    water+=uLine*smoothstep(.58,.88,s1)*smoothstep(.15,.95,swell)*.06;
    water+=uLine*smoothstep(.5,.8,s1)*cat*.03;
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
  float a2=uv.y-HZ;
  if(abs(a2)<.02){                                                          // считаем только у самого горизонта
    float hx=uv.x*asp;
    float isle=smoothstep(.44,.6,noise(vec2(hx*2.2,4.1)));
    float ih=(.003+.011*fbm(vec2(hx*20.,1.7)))*isle;
    vec3 ic=mix(uIsle,uHz,.22);
    col=mix(col,ic,(1.-smoothstep(ih-.0025,ih+.0008,a2))*smoothstep(-.0012,.0012,a2)*isle*.9);
    col=mix(col,mix(col,ic,.45),(1.-smoothstep(ih*.75-.003,ih*.75+.001,-a2))*smoothstep(-.001,.002,-a2)*isle*.5);
  }
  // чайки: днём и в сумерках пара птиц и одна поодаль медленно планируют над водой
  float birdsOn=1.-smoothstep(.45,.85,uDark);
  if(birdsOn>0.&&uv.y>HZ&&uv.y<HZ+.2){                                    // считаем только в полосе над горизонтом
    for(int i=0;i<3;i++){
      float fi=float(i);
      float ph=i==0?.31:i==1?.285:.6;
      float bx=fract(uT*.0045+ph)*1.5-.25;
      float by=HZ+(i==0?.075:i==1?.09:.12)+.01*sin(uT*.23+fi*2.);
      float sz=i==0?.0115:i==1?.0098:.0075;
      vec2 b=(uv-vec2(bx,by))*vec2(asp,1.)/sz;
      float ax=abs(b.x);
      float flap=.42+.22*sin(uT*2.1+fi*2.7);
      float wy=flap*(2.3*ax-1.9*ax*ax);
      float th=.075*(1.-ax*.75)+.03;
      float pb=px/sz;
      float m=(1.-smoothstep(th,th+pb*1.2,abs(b.y-wy)))*(1.-smoothstep(.9,1.,ax));
      col=mix(col,mix(col*.42,uIsle*.5,.4),m*.75*birdsOn);
    }
  }
  // буи сети 404 вдали: веха качается на зыби, наверху медленно «дышит» огонёк, ночью от него дорожка по воде
  float lightK=mix(.14,1.,uDark);
  if(abs(below-.1)<.16)                                                     // только в полосе у горизонта
  for(int i=0;i<4;i++){
    float fi=float(i);
    vec2 B=i==0?vec2(.13,10.5):i==1?vec2(.31,7.):i==2?vec2(.69,12.5):vec2(.875,6.2);
    float k=10./B.y;                                                      // ближе — крупнее
    vec2 s=(uv-vec2(B.x,HZ-(1./B.y-.06)+sin(uT*1.15+fi*2.1)*.0007*k))*vec2(asp,1.);
    s.x-=s.y*sin(uT*.9+fi*1.3)*.1;
    float hB=.0105*k,wB=.0006*k+px*.3;
    float m=(1.-smoothstep(wB-px*.6,wB+px*.6,abs(s.x)))*smoothstep(-px,px,s.y)*(1.-smoothstep(hB-px,hB+px,s.y));
    float fl=length(vec2(s.x/(.0022*k),(s.y-.0003*k)/(.0012*k)));
    m=max(m,(1.-smoothstep(.8,1.15,fl))*smoothstep(-px,px,s.y+.0002*k));
    col=mix(col,mix(uIsle*.55,uHz,.2+.3*(1.-k*.6)),m*.85);
    vec2 lp=s-vec2(0.,hB+.0005*k);
    float r2=dot(lp,lp)/(k*k);
    float br=(.22+.78*pow(.5+.5*sin(uT*.7+fi*2.4),3.))*lightK;
    col+=uBeacon*(exp(-r2/.0000022)*.9+exp(-r2/.00008)*.24)*br;
    float dy=-s.y;
    float rf=exp(-s.x*s.x/(.0000020*k*k))*exp(-max(dy,0.)/(.02*k))*step(0.,dy)*(.5+.5*sin(dy*650./k-uT*2.4));
    col+=uBeacon*rf*.16*br*uDark;
  }
  col*=mix(.82,1.,smoothstep(1.25,.35,distance(uv,vec2(.5,.55))));         // мягкая виньетка
  if(uFlare>0.){                                                            // блик объектива (интро)
    float sunUp=smoothstep(-.005,.02,uSun.y-HZ),moonUp=smoothstep(-.005,.02,uMoon.y-HZ);
    col+=flare(uv,uSun.xy,asp,uSunC)*uSun.z*sunUp*uFlare*mix(.6,1.,uDark);   // в ярком небе блик тише
    col+=flare(uv,uMoon.xy,asp,uMoonC)*moonLight*moonUp*uFlare*.5*mix(.25,1.,uDark);
  }
  col+=(hash(gl_FragCoord.xy+fract(uT))-.5)/255.;                           // против полос на градиенте
  gl_FragColor=vec4(col*uGain,1.);
}`;

/** Доля пути к цели за кадр — одинаковая плавность на 60 и на 144 Гц. */
export const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixV = (a: V3, b: V3, k: number) => a.map((v, i) => v + (b[i] - v) * k) as V3;
export const lerp3 = (a: V3, b: V3, k: number) => { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k; };

export interface Frame {
  t: number; ptr: number[]; power: number; gain: number; pulse: number[];
  pal: Pal; moonC: V3; sun: number[]; moon: number[];
  hz: number; bodyK: number; flare: number; dark: number; beacon: V3;
}

/** Часы моря: секунды с открытия страницы — у фона и интро одна и та же вода в один момент */
export const seaClock = () => performance.now() / 1000;

export function createSea(canvas: HTMLCanvasElement, force: boolean, scale0 = 0.5) {
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: !force,                 // на программном рендере — запасной вариант
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
  const names = ['uRes', 'uT', 'uPtr', 'uPower', 'uGain', 'uPulse', 'uTop', 'uHz', 'uFar', 'uNear', 'uLine', 'uIsle', 'uSunC', 'uMoonC', 'uSun', 'uMoon',
    'uStars', 'uClouds', 'uHzY', 'uBodyK', 'uFlare', 'uDark', 'uBeacon'];
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
  let scale = scale0;   // мягкая картинка: половины разрешения хватает
  let lw = 0, lh = 0;
  return {
    resize(w: number, h: number) {
      lw = w; lh = h;
      canvas.width = Math.max(2, Math.round(Math.min(w, 2200) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w: number, h: number) { scale = 0.3; this.resize(w, h); },
    /** Расфокус камеры без CSS-размытия: картинка рисуется мельче и мягко растягивается — почти бесплатно */
    setScale(k: number) {
      if (Math.abs(k - scale) < 0.004) return;
      scale = k;
      if (lw) this.resize(lw, lh);
    },
    draw(f: Frame) {
      const v3 = (n: string, c: V3) => gl.uniform3f(u[n], c[0], c[1], c[2]);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uT, f.t);
      gl.uniform2f(u.uPtr, f.ptr[0], f.ptr[1]);
      gl.uniform1f(u.uPower, f.power);
      gl.uniform1f(u.uGain, f.gain);
      gl.uniform4f(u.uPulse, f.pulse[0], f.pulse[1], f.pulse[2], f.pulse[3]);
      v3('uTop', f.pal.top); v3('uHz', f.pal.hz); v3('uFar', f.pal.far); v3('uNear', f.pal.near);
      v3('uLine', f.pal.line); v3('uIsle', f.pal.isle); v3('uSunC', f.pal.sun); v3('uMoonC', f.moonC); v3('uBeacon', f.beacon);
      gl.uniform4f(u.uSun, f.sun[0], f.sun[1], f.sun[2], f.sun[3]);
      gl.uniform4f(u.uMoon, f.moon[0], f.moon[1], f.moon[2], f.moon[3]);
      gl.uniform1f(u.uStars, f.pal.stars);
      gl.uniform1f(u.uClouds, f.pal.clouds);
      gl.uniform1f(u.uHzY, f.hz);
      gl.uniform1f(u.uBodyK, f.bodyK);
      gl.uniform1f(u.uFlare, f.flare);
      gl.uniform1f(u.uDark, f.dark);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    /**
     * Отдать контекст видеокарте сразу, не дожидаясь сборщика мусора (интро после себя).
     * Только если холст правда убран со страницы: в режиме разработки React монтирует эффект дважды.
     */
    dispose() { setTimeout(() => { if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext(); }, 0); },
  };
}
export type Sea = NonNullable<ReturnType<typeof createSea>>;

const MOON_WHITE = hex('#EEF1F8'), MOON_LOW = hex('#F2C79A');

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
export function targets(mode: Mode, moonProp: number) {
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
    dark: 1 - smooth(-6, 4, now.sunAlt),      // огоньки буёв: ночью видны, днём едва
    beacon: BEACON[mode],
  };
}
export type Targets = ReturnType<typeof targets>;

/** Начальный кадр из целей (копии массивов — дальше кадр живёт сам) */
export function frameFrom(tg: Targets, hz: number): Frame {
  const c = (v: V3) => [...v] as V3;
  return {
    t: seaClock(), ptr: [0.5, 0.5], power: 0, gain: 0, pulse: [0, 0, 0, 0],
    pal: { ...tg.pal, top: c(tg.pal.top), hz: c(tg.pal.hz), far: c(tg.pal.far), near: c(tg.pal.near), line: c(tg.pal.line), isle: c(tg.pal.isle), sun: c(tg.pal.sun) },
    moonC: c(tg.moonC), sun: [...tg.sun], moon: [...tg.moon],
    hz, bodyK: 1, flare: 0, dark: tg.dark, beacon: c(tg.beacon),
  };
}

/**
 * Светило идёт за настоящим положением без запаздывания (движение по дуге в реальном времени).
 * Если цель прыгнула (сменили тему), светило не едет через всё небо: гаснет и проявляется на новом месте.
 */
export function trackBody(cur: number[], tg: number[], fading: { on: boolean }, dt: number) {
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

/** Пока интро закрывает экран, фон не рисует (одна сцена на видеокарте вместо двух) */
export const introCover = { on: false };
