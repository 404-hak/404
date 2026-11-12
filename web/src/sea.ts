import type { Mode } from './types';
import { currentSky, liveAt, skyBodies } from './theme';
import { hex, palAt, type Pal, type V3 } from './skyPalette';
import { WARN, design } from './design';

/**
 * Море дельты — один рисовальщик для фона сайта и для интро: одно небо, одна вода, одни светила.
 * Интро отличается только ракурсом (горизонт ниже, светила крупнее) и бликом объектива.
 */

/** Режим подкрашивает море: настороженность — янтарём, тревога — красным */
export const TINT: Record<Mode, { c: V3; k: number }> = {
  calm: { c: [0, 0, 0], k: 0 }, alertness: { c: hex(WARN.night), k: design === 'upk' ? 0.05 : 0.12 }, alarm: { c: hex('#EF4444'), k: 0.18 }, intercept: { c: hex('#EF4444'), k: 0.14 },
};
export const SPEED: Record<Mode, number> = { calm: 1, alertness: 1.2, alarm: 1.55, intercept: 1.4 };
/** Огоньки буёв сети: спокойно — шалфей, настороженность — янтарь, тревога — красный */
const BEACON: Record<Mode, V3> = { calm: hex('#D2E4BF'), alertness: hex(design === 'upk' ? '#E9D29A' : '#FFC46E'), alarm: hex('#FF6C5E'), intercept: hex('#FF6C5E') };

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
/** Растяжка кадра, нарисованного мельче (расфокус камеры в интро): одна выборка с линейной фильтрацией */
const BLIT = 'precision mediump float;uniform sampler2D uSrc;uniform vec2 uK;uniform vec2 uRes;void main(){gl_FragColor=texture2D(uSrc,gl_FragCoord.xy/uRes*uK);}';
// Своя стилистика — между реализмом и графикой, всё плавное: небо мягким градиентом, мягкое свечение
// солнца и луны (луна в фазе), звёзды-точки, слоистые облака и дымка у горизонта, острова в дымке.
// Вода — течения и зыбь, свет мягкими мазками, под светилом переливается дорожка, по воде бегут
// тёмные пятна ряби от порывов ветра. Почерк 404 — изобаты: тонкие плавные линии, как на морской
// карте и экране сонара. Вдали качаются буи сети с «дышащими» огоньками, днём над водой планируют чайки.
// Шум — из готовой текстуры (одна выборка вместо четырёх синусов): в разы легче для видеокарты.
// INTRO — то же море плюс поплавок в воде: отражение, подводная часть, мениск, круги и пена.
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;uniform float uGain;uniform vec4 uPulse;
uniform vec3 uTop;uniform vec3 uHz;uniform vec3 uFar;uniform vec3 uNear;uniform vec3 uLine;uniform vec3 uIsle;
uniform vec3 uSunC;uniform vec3 uMoonC;uniform vec4 uSun;uniform vec4 uMoon;uniform float uStars;uniform float uClouds;
uniform float uHzY;uniform float uBodyK;uniform float uFlare;uniform float uDark;uniform vec3 uBeacon;
uniform sampler2D uNoise;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){return texture2D(uNoise,p*.03125).r;}
float noise2(vec2 p){return texture2D(uNoise,p*.03125).g;}
const mat2 RM=mat2(1.6,1.2,-1.2,1.6);
float fbm(vec2 p){vec2 p2=RM*p;return noise(p)*.5+noise(p2)*.25+noise(RM*p2)*.125;}
vec2 plane(vec2 uv,float asp){float below=max(uHzY-uv.y,.001);float d=1./(below+.06);return vec2((uv.x-.5)*asp*d*.35,d);}
// блик объектива: тонкий горизонтальный луч через светило и мягкое рассеяние вдоль него
vec3 flare(vec2 uv,vec2 L,float asp,vec3 c){
  vec2 p=(uv-L)*vec2(asp,1.);
  float ax=abs(p.x);
  return c*(exp(-p.y*p.y*9000.)*exp(-ax*3.)*.36+exp(-p.y*p.y*700.)*exp(-ax*5.)*.1);
}
#ifdef INTRO
uniform sampler2D uMarkTex;uniform vec4 uMark;uniform vec4 uMark2;uniform vec4 uRing[6];uniform vec3 uAccent;uniform vec2 uImp;
uniform vec4 uCont[2];uniform float uFoam;
// знак в точке экрана (x — в долях высоты): uMark — опора на ватерлинии (x, y), верх и высота знака; uMark2 — cos, sin наклона, ширина/высота, видимость
vec4 mark(vec2 a){
  vec2 d=a-uMark.xy;
  d=vec2(uMark2.x*d.x-uMark2.y*d.y,uMark2.y*d.x+uMark2.x*d.y);
  vec2 tc=vec2(d.x/(uMark.w*uMark2.z)+.5,(uMark.z-uMark.y-d.y)/uMark.w);
  if(tc.x<0.||tc.x>1.||tc.y<0.||tc.y>1.)return vec4(0.);
  return texture2D(uMarkTex,tc);
}
#endif
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
    if(uStars>.01){
      vec2 sp=vec2(uv.x*asp,uv.y)*140.;vec2 cell=floor(sp);float h=hash(cell);
      if(h>.962){
        vec2 off=vec2(hash(cell+3.1),hash(cell+7.7))-.5;
        float st=smoothstep(.3,0.,length(fract(sp)-.5-off*.55));
        col+=vec3(.9,.93,1.)*st*(.55+.45*sin(uT*(.4+h*1.2)+h*60.))*.8*uStars*smoothstep(0.,.07,a);
      }
    }
    // слоистые облака у горизонта — вытянутые, мягкие, подсвечены светилом
    if(a<.85&&uClouds>0.){
      float cl=fbm(vec2(uv.x*asp*1.3+uT*.005,uv.y*11.));
      float cloud=smoothstep(.52,.78,cl)*smoothstep(0.,.12,a)*smoothstep(.85,.3,a)*uClouds;
      vec3 cc=mix(uHz,uTop,.35)*1.06+uSunC*.12*uSun.z+uMoonC*.04*moonLight;
      col=mix(col,cc,cloud*.5);
    }
    // солнце — мягкий диск
    col=mix(col,uSunC,smoothstep(uSun.w,uSun.w*.72,rs)*uSun.z);
    // луна — мягкий диск в фазе: тень — сдвинутый диск с размытым краем, пепельный свет
    if(rm<.03){
      float R=.021;
      float disc=smoothstep(R,R*.84,rm);
      float ph=abs(uMoon.w),side=uMoon.w<0.?-1.:1.;
      float shade=smoothstep(R*1.04,R*.74,length(dm+vec2(side*2.*R*ph,0.)));
      col=mix(col,col*.8+uMoonC*.05,disc*uMoon.z*uStars);                    // тёмная часть видна только ночью
      col=mix(col,uMoonC,disc*(1.-shade)*uMoon.z);
    }
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
#ifdef INTRO
    // волны от поплавка: каждое событие — цуг из нескольких гребней под мягкой огибающей
    // (как от брошенного в воду предмета); считаем наклон поверхности — по склонам ложатся
    // свет и тень. Сигнал сонара — отдельные кольца цветом акцента.
    vec2 ic=plane(uImp,asp);
    float dI=distance(w*vec2(1.,.55),ic*vec2(1.,.55));
    float wave=0.,sonar=0.;
    for(int i=0;i<6;i++){
      vec4 R=uRing[i];
      float x=dI-R.x;
      float env=exp(-x*x/(R.z*R.z))*R.y;
      if(R.w<.5){
        float k=18.85/R.z;                                  // около трёх гребней на ширину огибающей
        wave+=env*sin(k*x+1.2*x/R.z);                       // впереди гребни чуть реже — дисперсия
      }else sonar+=env;
    }
    w+=normalize(w-ic+1e-4)*wave*.022;
#endif
    vec2 q=vec2(fbm(w*.6+vec2(t*.03,0.)),noise2(w*.9+vec2(5.2,1.3)-vec2(0.,t*.02)));
    float f=fbm(w*.6+2.*q+vec2(0.,-t*.05));
    float depth=clamp(below/HZ,0.,1.);
    vec3 water=mix(uFar,uNear,smoothstep(0.,1.,pow(depth,.5)));
    water=mix(water,water*1.1+uLine*.02,smoothstep(.35,.8,f)*.6);          // течения
    // порывы ветра: по воде медленно бегут тёмные пятна мелкой ряби
    float gust=noise2(w*vec2(.5,.85)+vec2(-t*.08,t*.025)+3.7);
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
    float g=noise2(vec2(w.x*7.,w.y*16.)+q*3.+vec2(t*.25,-t*1.1));
    float glit=smoothstep(.45,.95,g)*smoothstep(.1,.9,swell+.3);
    float wd=mix(.02,.36,depth);
    float ls=(uv.x-uSun.x)*asp;float ps=exp(-ls*ls/(wd*wd));
    float lm=(uv.x-uMoon.x)*asp;float pm=exp(-lm*lm/(wd*wd*.8));
    water+=uSunC*ps*(glit*.85+.07)*uSun.z;
    water+=uMoonC*pm*(glit*.7+.035)*moonLight;
    float lp=(uv.x-uPtr.x)*asp;
    water+=uLine*exp(-lp*lp/(wd*wd*.6))*glit*.22*uPower;
    water+=uLine*ring*.1;
#ifdef INTRO
    water+=uLine*wave*.2*(1.+.5*smoothstep(.0,.6,wave));   // свет на склонах к зрителю, тень — на обратных
    water+=uAccent*(sonar*.55+sonar*sonar*.25);
    if(uFoam>0.){                                          // пена в месте удара: расходится и тает
      float fo=(1.-smoothstep(.25,1.,dI/(.12+.4*(1.-uFoam))))*smoothstep(.38,.72,noise(w*vec2(9.,16.)+vec2(0.,t*.8)));
      water=mix(water,mix(uLine,vec3(1.),.35),fo*uFoam*.75);
    }
    if(uMark2.w>0.){
      vec2 a=vec2(uv.x*asp,uv.y);
      float wl=uMark.y,dep=wl-uv.y;
      if(abs(a.x-uMark.x)<uMark.w*.75&&dep>-.03&&dep<uMark.w*1.1){
        // рябь качает отражение: чем дальше от ватерлинии, тем сильнее
        float wob=(noise(vec2(a.x*30.,dep*140.-t*2.5))-.5)*.008*(.25+dep*14.)+wave*.012;
        if(dep>0.){
          vec4 rf=mark(vec2(a.x+wob,wl+dep*1.04));                         // отражение надводной части
          water=mix(water,mix(water,rf.rgb/max(rf.a,.001),.6),rf.a*.42*exp(-dep/(uMark.w*.5))*uMark2.w);
          vec4 un=mark(vec2(a.x+wob*.6,wl-dep*1.35));                       // подводная часть сквозь воду: короче и тусклее
          water=mix(water,mix(water,un.rgb/max(un.a,.001)*.8+uNear*.2,.4),un.a*.55*exp(-dep/(uMark.w*.3))*uMark2.w);
        }
        // мениск: где тело входит в воду — светлое колечко и тень на воде у самого тела
        float ry=.636*(HZ-wl+.06);
        for(int i=0;i<2;i++){
          vec4 C=uCont[i];
          for(int j=0;j<2;j++){
            vec2 sg=j==0?C.xy:C.zw;
            float on=step(sg.x+1e-5,sg.y);
            float hw=(sg.y-sg.x)*.5+.0035;
            float e=length(vec2((a.x-(sg.x+sg.y)*.5)/hw,(uv.y-wl)/max(hw*ry,px*1.6)));
            water*=1.-.22*(1.-smoothstep(.35,1.,e))*on*uMark2.w;
            water+=uLine*exp(-pow((e-1.)*hw/max(px*1.4,hw*.14),2.))*.32*on*uMark2.w;
          }
        }
      }
    }
#endif
    col=mix(water,uHz,smoothstep(.12,0.,below)*.6);                         // у горизонта вода тонет в дымке
  }
  float a2=uv.y-HZ;
  col+=mix(uHz,vec3(1.),.3)*exp(-a2*a2*3600.)*.1;                           // светлая дымка горизонта
  // дымка над водой: медленно плывёт вдоль горизонта
  float mb=exp(-pow((a2-.006)*14.,2.));
  if(mb>.03)col=mix(col,mix(uHz,vec3(1.),.25),mb*smoothstep(.3,.8,noise2(vec2(uv.x*asp*1.2+uT*.012,7.3)))*.14);
  // острова дельты: мягкие силуэты в дымке и их отражение
  if(abs(a2)<.02){                                                          // считаем только у самого горизонта
    float hx=uv.x*asp;
    float isle=smoothstep(.44,.6,noise(vec2(hx*2.2,4.1)));
    if(isle>0.){
      float ih=(.003+.011*fbm(vec2(hx*20.,1.7)))*isle;
      vec3 ic=mix(uIsle,uHz,.22);
      col=mix(col,ic,(1.-smoothstep(ih-.0025,ih+.0008,a2))*smoothstep(-.0012,.0012,a2)*isle*.9);
      col=mix(col,mix(col,ic,.45),(1.-smoothstep(ih*.75-.003,ih*.75+.001,-a2))*smoothstep(-.001,.002,-a2)*isle*.5);
    }
  }
  // чайки: днём и в сумерках пара птиц и одна поодаль медленно планируют над водой
  float birdsOn=1.-smoothstep(.45,.85,uDark);
  if(birdsOn>0.&&a2>0.&&a2<.2){                                             // считаем только в полосе над горизонтом
    for(int i=0;i<3;i++){
      float fi=float(i);
      float ph=i==0?.31:i==1?.285:.6;
      float bx=fract(uT*.0045+ph)*1.5-.25;
      float by=HZ+(i==0?.075:i==1?.09:.12)+.01*sin(uT*.23+fi*2.);
      float sz=i==0?.0115:i==1?.0098:.0075;
      vec2 b=(uv-vec2(bx,by))*vec2(asp,1.)/sz;
      float ax=abs(b.x);
      if(ax<1.&&abs(b.y)<1.){
        float flap=.42+.22*sin(uT*2.1+fi*2.7);
        float wy=flap*(2.3*ax-1.9*ax*ax);
        float th=.075*(1.-ax*.75)+.03;
        float m=(1.-smoothstep(th,th+px/sz*1.2,abs(b.y-wy)))*(1.-smoothstep(.9,1.,ax));
        col=mix(col,mix(col*.42,uIsle*.5,.4),m*.75*birdsOn);
      }
    }
  }
  // буи сети 404 вдали: веха качается на зыби, наверху медленно «дышит» огонёк, ночью от него дорожка по воде
  if(abs(below-.1)<.16){                                                    // только в полосе у горизонта
    float lightK=mix(.14,1.,uDark);
    for(int i=0;i<4;i++){
      float fi=float(i);
      vec2 B=i==0?vec2(.13,10.5):i==1?vec2(.31,7.):i==2?vec2(.69,12.5):vec2(.875,6.2);
      float k=10./B.y;                                                    // ближе — крупнее
      vec2 s=(uv-vec2(B.x,HZ-(1./B.y-.06)+sin(uT*1.15+fi*2.1)*.0007*k))*vec2(asp,1.);
      if(abs(s.x)>.03*k)continue;
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

/**
 * Текстура шума 256×256: плавный шум с периодом 32 клетки, в каналах R и G — два независимых.
 * Считается один раз на страницу; выборка из неё дешевле синусов в каждой точке экрана.
 */
let noiseData: Uint8Array | null = null;
function noiseTexture() {
  if (noiseData) return noiseData;
  const N = 256, C = 32, S = N / C;
  const out = new Uint8Array(N * N * 4);
  const lat = new Float32Array(C * C);
  for (let ch = 0; ch < 4; ch++) {
    let seed = 1234577 + ch * 7919;
    for (let i = 0; i < lat.length; i++) { seed = (seed * 16807) % 2147483647; lat[i] = (seed - 1) / 2147483646; }
    for (let y = 0; y < N; y++) {
      const iy = Math.floor(y / S), ty0 = y / S - iy, ty = ty0 * ty0 * (3 - 2 * ty0);
      const r0 = (iy % C) * C, r1 = ((iy + 1) % C) * C;
      for (let x = 0; x < N; x++) {
        const ix = Math.floor(x / S), tx0 = x / S - ix, tx = tx0 * tx0 * (3 - 2 * tx0);
        const c0 = ix % C, c1 = (ix + 1) % C;
        const v = (lat[r0 + c0] * (1 - tx) + lat[r0 + c1] * tx) * (1 - ty) + (lat[r1 + c0] * (1 - tx) + lat[r1 + c1] * tx) * ty;
        out[(y * N + x) * 4 + ch] = Math.round(v * 255);
      }
    }
  }
  noiseData = out;
  return out;
}

/** Доля пути к цели за кадр — одинаковая плавность на 60 и на 144 Гц. */
export const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixV = (a: V3, b: V3, k: number) => a.map((v, i) => v + (b[i] - v) * k) as V3;
export const lerp3 = (a: V3, b: V3, k: number) => { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k; };

export interface Frame {
  t: number; ptr: number[]; power: number; gain: number; pulse: number[];
  pal: Pal; moonC: V3; sun: number[]; moon: number[];
  hz: number; bodyK: number; flare: number; dark: number; beacon: V3;
  intro?: IntroFrame;
}
/** Поплавок интро в воде: опора, верх и высота знака, наклон, кольца, места входа в воду, пена */
export interface IntroFrame {
  mark: number[]; mark2: number[]; rings: Float32Array; accent: V3; imp: number[]; cont: Float32Array; foam: number;
}

/** Часы моря: секунды с открытия страницы — у фона и интро одна и та же вода в один момент */
export const seaClock = () => performance.now() / 1000;

/**
 * Холст моря. Шейдер собирается без остановки страницы (KHR_parallel_shader_compile, где есть):
 * пока он готовится, status() — 'pending', рисовать ещё нечего; 'fail' — запасной вариант.
 */
export function createSea(canvas: HTMLCanvasElement, force: boolean, opts: { scale?: number; intro?: boolean } = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: !force,                 // на программном рендере — запасной вариант
  });
  if (!gl) return null;
  const par = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  const shader = (type: number, src: string) => { const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
  const prog = gl.createProgram()!;
  const fsh = shader(gl.FRAGMENT_SHADER, (opts.intro ? '#define INTRO\n' : '') + FRAGMENT);
  const vsh = shader(gl.VERTEX_SHADER, VERTEX);
  gl.attachShader(prog, vsh);
  gl.attachShader(prog, fsh);
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);

  let state: 'pending' | 'ok' | 'fail' = 'pending';
  let u: Record<string, WebGLUniformLocation | null> = {};
  const markTex = gl.createTexture();
  // расфокус (интро): сцена рисуется в текстуру мельче и растягивается на холст — размер холста не меняется
  let blit: { prog: WebGLProgram; uK: WebGLUniformLocation | null; uRes: WebGLUniformLocation | null } | null = null;
  let fbo: WebGLFramebuffer | null = null, fboTex: WebGLTexture | null = null, fboW = 0, fboH = 0;
  let focus = 1;
  const finish = () => {
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('404: море не собралось —', gl.getShaderInfoLog(fsh) || gl.getProgramInfoLog(prog));
      state = 'fail';
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const names = ['uRes', 'uT', 'uPtr', 'uPower', 'uGain', 'uPulse', 'uTop', 'uHz', 'uFar', 'uNear', 'uLine', 'uIsle', 'uSunC', 'uMoonC', 'uSun', 'uMoon',
      'uStars', 'uClouds', 'uHzY', 'uBodyK', 'uFlare', 'uDark', 'uBeacon', 'uNoise',
      'uMarkTex', 'uMark', 'uMark2', 'uRing', 'uAccent', 'uImp', 'uCont', 'uFoam'];
    u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
    // шум: плавная текстура с мипмапами — у горизонта мелкая рябь не мерцает
    const nt = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, nt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseTexture());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.uniform1i(u.uNoise, 0);
    gl.uniform1i(u.uMarkTex, 1);
    if (opts.intro) {
      const bp = gl.createProgram()!;
      gl.attachShader(bp, vsh);
      gl.attachShader(bp, shader(gl.FRAGMENT_SHADER, BLIT));
      gl.bindAttribLocation(bp, 0, 'p');
      gl.linkProgram(bp);
      if (gl.getProgramParameter(bp, gl.LINK_STATUS)) {
        gl.useProgram(bp);
        gl.uniform1i(gl.getUniformLocation(bp, 'uSrc'), 2);
        blit = { prog: bp, uK: gl.getUniformLocation(bp, 'uK'), uRes: gl.getUniformLocation(bp, 'uRes') };
        gl.useProgram(prog);
      }
    }
    state = 'ok';
  };

  let scale = opts.scale ?? 0.5;   // мягкая картинка: половины разрешения хватает
  /** Готов ли шейдер: проверка не ждёт видеокарту, если браузер умеет собирать в фоне */
  const status = () => {
    if (state === 'pending' && (!par || gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR))) finish();
    return state;
  };
  return {
    status,
    resize(w: number, h: number) {
      canvas.width = Math.max(2, Math.round(Math.min(w, 2200) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w: number, h: number) { scale = Math.min(scale, 0.34); this.resize(w, h); },
    /**
     * Расфокус камеры без CSS-размытия: сцена рисуется в текстуру мельче (k — доля разрешения) и мягко
     * растягивается. Холст не пересоздаётся — раньше смена его размера каждый кадр и давала рывки.
     */
    setFocus(k: number) { focus = Math.min(1, Math.max(0.05, k)); },
    /** Знак для отражения и подводной части (интро): картинка с прозрачностью */
    setMark(img: TexImageSource) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, markTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
    },
    draw(f: Frame) {
      if (status() !== 'ok') return;
      const cw = canvas.width, ch = canvas.height;
      const soft = focus < 0.97 && blit != null;
      let rw = cw, rh = ch;
      if (soft) {
        if (!fbo || fboW !== cw || fboH !== ch) {          // текстура под размер холста — один раз (и при смене окна)
          fboTex = fboTex ?? gl.createTexture();
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, fboTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.activeTexture(gl.TEXTURE0);
          fbo = fbo ?? gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
          fboW = cw; fboH = ch;
        }
        rw = Math.max(2, Math.round(cw * focus)); rh = Math.max(2, Math.round(ch * focus));
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, rw, rh);
      }
      gl.useProgram(prog);
      const v3 = (n: string, c: V3) => gl.uniform3f(u[n], c[0], c[1], c[2]);
      gl.uniform2f(u.uRes, rw, rh);
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
      const it = f.intro;
      if (it) {
        gl.uniform4f(u.uMark, it.mark[0], it.mark[1], it.mark[2], it.mark[3]);
        gl.uniform4f(u.uMark2, it.mark2[0], it.mark2[1], it.mark2[2], it.mark2[3]);
        gl.uniform4fv(u.uRing, it.rings);
        gl.uniform4fv(u.uCont, it.cont);
        gl.uniform3f(u.uAccent, it.accent[0], it.accent[1], it.accent[2]);
        gl.uniform2f(u.uImp, it.imp[0], it.imp[1]);
        gl.uniform1f(u.uFoam, it.foam);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (soft && blit) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        gl.useProgram(blit.prog);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform2f(blit.uK, rw / cw, rh / ch);
        gl.uniform2f(blit.uRes, cw, ch);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
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
