import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { FeatureCollection, Position } from 'geojson';
import { target, type Buoy, type BuoyStatus, type Sector, type State } from './types';
import type { Bounds, MapHandle } from './geo';
import { distanceKm, pad } from './geo';
import { km } from './format';
import { WARN, design } from './design';

/**
 * 3D-карта района: плита дельты по OpenStreetMap (вода, протоки, плавни) — как диорама,
 * над ней буи с огоньками статуса, связи сети, зоны риска стенами света, катер инспектора
 * и маршрут перехвата дугой с бегущим пунктиром. Работает без интернета.
 * Единица сцены — километр; север — вдаль (−z). Кадры: в покое 30 в секунду, при движении 60.
 */

type Theme = 'night' | 'day';
const PALETTE = {
  night: {
    land: '#131d29', wetland: '#1a2925', water: '#0c1d33', river: '#16375a', coast: 'rgba(140,180,215,.5)',
    outside: 'rgba(4,9,18,.6)', primary: '#E2E8F0', grid: '#E2E8F0', sideTop: '#11223a', sideBottom: '#050b15', glint: '#cfe3ff',
    ok: '#A3B58F', warn: WARN.night, alert: '#EF4444', offline: '#6B7686', shadow: 0.55, additive: true, glowK: 1,
  },
  day: {
    land: '#e2e2d4', wetland: '#cbd5ba', water: '#a7c3db', river: '#97b7d4', coast: 'rgba(60,95,130,.55)',
    outside: 'rgba(244,247,250,.58)', primary: '#0B1628', grid: '#0B1628', sideTop: '#c3d1de', sideBottom: '#8ea4b8', glint: '#ffffff',
    ok: '#7A8F69', warn: design === 'upk' ? WARN.day : '#D98A10', alert: '#D63131', offline: '#9AA3B0', shadow: 0.22, additive: false, glowK: 0.35,
  },
};
type Pal = (typeof PALETTE)['night'];

const FOV = 38;
const THICK = 2.2;                 // толщина плиты, км
const DEF = { phi: 0.93, theta: -0.28 };
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
/** Пружинка: от 0 к 1 с лёгким перелётом (буи «встают» на воду) */
const springIn = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2);

/** Мягкое круглое пятно — для огоньков и тени */
function radialTexture(size: number, stops: [number, string][]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const GROUND_VS = /* glsl */`
varying vec2 vUv; varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
// вода чуть живёт: медленная зыбь и блёстки; при открытии плита проявляется кругом от центра
const GROUND_FS = /* glsl */`
uniform sampler2D uMap; uniform sampler2D uMask; uniform float uT; uniform float uReveal; uniform vec2 uHalf;
uniform vec3 uGlint; uniform vec3 uEdge; uniform vec3 uHidden;
varying vec2 vUv; varying vec3 vW;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec3 col = texture2D(uMap, vUv).rgb;
  float m = texture2D(uMask, vUv).r;
  float swell = sin(vW.x * .35 + vW.z * .22 - uT * .5) * .5 + .5;
  col += uGlint * m * swell * .025;
  float sp = vnoise(vW.xz * 1.6 + vec2(uT * .18, -uT * .11)) * vnoise(vW.xz * 2.7 - vec2(uT * .07, uT * .15));
  col += uGlint * m * smoothstep(.5, .78, sp) * .07;
  float r = length(vW.xz / uHalf) / 1.42;
  float hidden = smoothstep(uReveal - .05, uReveal, r);
  col = mix(col, uHidden, hidden);
  col += uEdge * exp(-pow((r - uReveal) / .014, 2.)) * .3 * step(uReveal, 1.2);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// стены зон риска: свет снизу вверх гаснет, по стене медленно поднимается полоса
const CURTAIN_VS = /* glsl */`
attribute float h; varying float vH;
void main(){ vH = h; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const CURTAIN_FS = /* glsl */`
uniform vec3 uColor; uniform float uK; uniform float uT; varying float vH;
void main(){
  float a = pow(1. - vH, 1.6) * .42 + exp(-pow((vH - fract(uT * .18)) / .05, 2.)) * .18 * (1. - vH);
  gl_FragColor = vec4(uColor, a * uK);
  #include <colorspace_fragment>
}`;

interface BuoyObj {
  id: string; status: BuoyStatus; i: number; group: THREE.Group; body: THREE.Mesh; glow: THREE.Sprite; hit: THREE.Mesh;
  sel: THREE.Mesh; rings: THREE.Mesh[]; beam: THREE.Mesh | null; label: HTMLDivElement; selK: number;
}

export interface Delta3DOptions {
  theme: Theme; area: Bounds;
  onSelect: (id: string | null) => void;
  onHover: (b: { id: string; x: number; y: number } | null) => void;
}

export class Delta3D {
  readonly handle: MapHandle;
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: MapControls;
  private pal: Pal;
  private proj: { x: (lon: number) => number; z: (lat: number) => number };
  private half: THREE.Vector2;
  private ground!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private dynamic = new THREE.Group();
  private buoys: BuoyObj[] = [];
  private lines: LineMaterial[] = [];
  private frame: { line: Line2; segs: number } | null = null;
  private linkMats: { m: LineMaterial; o: number }[] = [];
  private route: LineMaterial | null = null;
  private curtains: { mat: THREE.ShaderMaterial; mesh: THREE.Mesh; floor: THREE.MeshBasicMaterial }[] = [];
  private inspector: THREE.Group | null = null;
  private disposables: { dispose: () => void }[] = [];
  private dyn: { dispose: () => void }[] = [];          // ресурсы слоя данных — освобождаются при пересборке
  private raf = 0;
  private t0 = performance.now();
  private last = 0;
  private lastActive = 0;
  private selected: string | null = null;
  private hoverId: string | null = null;
  private tween: { from: Cam; to: Cam; t0: number; ms: number } | null = null;
  private defRadius = 80;
  private ro: ResizeObserver;
  private ray = new THREE.Raycaster();
  private down = { x: 0, y: 0, t: 0 };
  private glowTex: THREE.Texture;
  private ringGeo = new THREE.RingGeometry(0.9, 1, 48);
  private dead = false;

  constructor(private host: HTMLElement, private opts: Delta3DOptions) {
    this.pal = PALETTE[opts.theme];
    const [[s, w], [n, e]] = opts.area;
    const lat0 = (s + n) / 2, lon0 = (w + e) / 2, kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
    this.proj = { x: (lon) => (lon - lon0) * kx, z: (lat) => -(lat - lat0) * ky };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !new URLSearchParams(location.search).has('sea') });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'absolute inset-0 h-full w-full';
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'm3d-labels pointer-events-none absolute inset-0';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 900);
    const bg = new THREE.Color(`rgb(${getComputedStyle(document.documentElement).getPropertyValue('--rgb-bg').trim().split(/\s+/).join(',') || '11,22,40'})`);
    this.scene.fog = new THREE.Fog(bg, 60, 260);
    this.scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x1a2230, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-30, 60, 40);
    this.scene.add(sun);
    this.glowTex = radialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
    this.disposables.push(this.glowTex, this.ringGeo);

    // плита: район с запасом
    const pb = pad(opts.area, 0.07);
    const W = this.proj.x(pb[1][1]) - this.proj.x(pb[0][1]), D = this.proj.z(pb[0][0]) - this.proj.z(pb[1][0]);
    this.half = new THREE.Vector2(W / 2, D / 2);
    this.buildSlab(pb, W, D);
    this.scene.add(this.dynamic);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.09, screenSpacePanning: false, minDistance: 7, maxDistance: 170,
      minPolarAngle: 0.08, maxPolarAngle: 1.22, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.9,
    });
    this.controls.addEventListener('change', () => { this.lastActive = performance.now(); this.clampTarget(); });
    this.controls.addEventListener('start', () => { this.tween = null; });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    // пролёт при открытии: сверху над районом — к наклонному виду
    const end = this.defaultCam();
    this.setCam({ target: new THREE.Vector3(), radius: end.radius * 1.7, phi: 0.03, theta: end.theta + 0.5 });
    this.tween = { from: this.getCam(), to: end, t0: performance.now() + 150, ms: 2600 };

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', this.onLeave);

    this.handle = {
      zoomIn: () => this.zoomBy(0.62),
      zoomOut: () => this.zoomBy(1.6),
      fitArea: () => this.flyCam(this.defaultCam(), 900),
      flyTo: (lat, lon, zoom = 11.5) => {
        const c = this.getCam();
        this.flyCam({ ...c, target: new THREE.Vector3(this.proj.x(lon), 0, this.proj.z(lat)), radius: Math.min(c.radius, 78 / 2 ** (zoom - 10)), phi: Math.min(c.phi, 0.95) }, 1000);
      },
    };
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- плита дельты ----------
  private buildSlab(pb: Bounds, W: number, D: number) {
    const P = this.pal;
    const TW = Math.min(3072, this.renderer.capabilities.maxTextureSize), TH = Math.round((TW * D) / W);
    const [[S, Wl], [N, E]] = pb;
    const px = (lon: number) => ((lon - Wl) / (E - Wl)) * TW, py = (lat: number) => ((N - lat) / (N - S)) * TH;
    const cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const g = cv.getContext('2d')!;
    const MW = 1024, MH = Math.round((MW * TH) / TW);
    const mk = document.createElement('canvas');
    mk.width = MW; mk.height = MH;
    const m = mk.getContext('2d')!;
    m.fillStyle = '#000'; m.fillRect(0, 0, MW, MH);
    g.fillStyle = P.land; g.fillRect(0, 0, TW, TH);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const mask = new THREE.CanvasTexture(mk);
    this.disposables.push(tex, mask);

    const area = this.opts.area;
    const outside = () => {
      // за границей района — приглушено, как на схеме
      const [[s, w], [n, e]] = area;
      g.fillStyle = P.outside;
      g.beginPath();
      g.rect(0, 0, TW, TH);
      g.rect(px(w), py(n), px(e) - px(w), py(s) - py(n));
      g.fill('evenodd');
    };
    outside();
    fetch('/geo/delta-osm.geojson').then((r) => r.json()).then((fc: FeatureCollection) => {
      if (this.dead) return;
      const order = ['wetland', 'sea', 'water', 'stream', 'river'];
      const feats = [...fc.features].sort((a, b) => order.indexOf(a.properties?.kind) - order.indexOf(b.properties?.kind));
      const k = TW / 3072;
      const path = (ctx: CanvasRenderingContext2D, rings: Position[][], sx: number) => {
        for (const r of rings) r.forEach(([lon, lat], i) => (i ? ctx.lineTo(px(lon) * sx, py(lat) * sx) : ctx.moveTo(px(lon) * sx, py(lat) * sx)));
      };
      g.fillStyle = P.land; g.fillRect(0, 0, TW, TH);
      for (const f of feats) {
        const kind = f.properties?.kind as string;
        const geom = f.geometry;
        const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : null;
        const lines = geom.type === 'MultiLineString' ? geom.coordinates : geom.type === 'LineString' ? [geom.coordinates] : null;
        if (polys) {
          g.beginPath();
          polys.forEach((p) => path(g, p, 1));
          g.fillStyle = kind === 'wetland' ? P.wetland : P.water;
          g.fill('evenodd');
          if (kind === 'sea') { g.strokeStyle = P.coast; g.lineWidth = 1.6 * k; g.stroke(); }
          if (kind !== 'wetland') {
            m.beginPath(); polys.forEach((p) => path(m, p, MW / TW)); m.fillStyle = '#fff'; m.fill('evenodd');
          }
        } else if (lines) {
          g.beginPath();
          lines.forEach((l) => path(g, [l], 1));
          g.strokeStyle = P.river; g.lineCap = 'round'; g.lineJoin = 'round';
          g.lineWidth = (kind === 'river' ? 3.2 : 1.6) * k;
          g.stroke();
          m.beginPath(); lines.forEach((l) => path(m, [l], MW / TW)); m.strokeStyle = '#fff'; m.lineWidth = kind === 'river' ? 1.5 : 0.8; m.stroke();
        }
      }
      outside();
      tex.needsUpdate = true;
      mask.needsUpdate = true;
    }).catch(() => { /* без подложки плита остаётся ровной — всё остальное работает */ });

    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uMap: { value: null }, uMask: { value: null }, uT: { value: 0 }, uReveal: { value: 0 }, uHalf: { value: new THREE.Vector2() },
        uGlint: { value: new THREE.Color(P.glint) }, uEdge: { value: new THREE.Color(P.primary) }, uHidden: { value: new THREE.Color(P.sideTop) },
      }]),
      vertexShader: GROUND_VS, fragmentShader: GROUND_FS, fog: true,
    });
    mat.uniforms.uMap.value = tex;
    mat.uniforms.uMask.value = mask;
    mat.uniforms.uHalf.value = this.half;
    const geo = new THREE.PlaneGeometry(W, D);
    geo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(geo, mat);
    this.scene.add(this.ground);

    // бока плиты: сверху цвет глубины, книзу темнее
    const box = new THREE.BoxGeometry(W, THICK, D);
    const pos = box.attributes.position, cols: number[] = [];
    const top = new THREE.Color(P.sideTop), bot = new THREE.Color(P.sideBottom);
    for (let i = 0; i < pos.count; i++) { const c = pos.getY(i) > 0 ? top : bot; cols.push(c.r, c.g, c.b); }
    box.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const side = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ vertexColors: true }));
    side.position.y = -THICK / 2 - 0.01;
    this.scene.add(side);

    // мягкая тень под плитой
    const shTex = radialTexture(128, [[0, `rgba(0,0,0,${P.shadow})`], [0.55, `rgba(0,0,0,${P.shadow * 0.45})`], [1, 'rgba(0,0,0,0)']]);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.5, D * 1.7), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = -THICK - 2.5;
    this.scene.add(sh);
    this.disposables.push(shTex, geo, mat, box, side.material as THREE.Material, sh.geometry, sh.material as THREE.Material);
  }

  // ---------- данные ----------
  /** Слой района: рамка, сетка секторов, зоны риска, связи, буи, катер, маршрут. Пересобирается при смене статусов. */
  setData(state: State, hot: number[]) {
    const P = this.pal, x = this.proj.x, z = this.proj.z;
    const boot = performance.now() - this.t0 < 1500;
    this.clearDynamic();
    const line = (pts: number[], o: Partial<LineMaterial> & { linewidth: number }) => {
      const geo = new LineGeometry();
      geo.setPositions(pts);
      const mat = new LineMaterial({ transparent: true, worldUnits: false, ...o } as never);
      mat.resolution.set(this.host.clientWidth, this.host.clientHeight);
      const l = new Line2(geo, mat);
      if (mat.dashed) l.computeLineDistances();
      this.lines.push(mat);
      this.dynamic.add(l);
      this.dyn.push(geo, mat);
      return { l, mat, geo };
    };
    const Y = 0.04;
    const rectPts = (s: number, w: number, n: number, e: number, steps = 1) => {
      const c = [[w, s], [w, n], [e, n], [e, s], [w, s]];
      const out: number[] = [];
      for (let i = 0; i < 4; i++) for (let j = 0; j < steps; j++) {
        const f = j / steps, a = c[i], b = c[i + 1];
        out.push(x(a[0] + (b[0] - a[0]) * f), Y, z(a[1] + (b[1] - a[1]) * f));
      }
      out.push(x(c[0][0]), Y, z(c[0][1]));
      return out;
    };

    // рамка района прорисовывается по периметру
    const [[s, w], [n, e]] = this.opts.area;
    const fr = line(rectPts(s, w, n, e, 60), { color: new THREE.Color(P.primary).getHex(), linewidth: 1.6, opacity: 0.6 } as never);
    this.frame = { line: fr.l, segs: 240 };
    if (!boot) this.frame = null;

    // сетка секторов
    const gridPts: number[][] = state.sectors.map((sc) => rectPts(sc.south, sc.west, sc.north, sc.east));
    for (const p of gridPts) {
      const g = line(p, { color: new THREE.Color(P.grid).getHex(), linewidth: 1, opacity: 0.16 } as never);
      this.linkMats.push({ m: g.mat, o: 0.16 });
    }

    // зоны риска: подсвеченный пол и стены света
    for (const sc of state.sectors.filter((q) => hot.includes(q.n))) this.addCurtain(sc);

    // подписи секторов
    for (const sc of state.sectors) {
      const div = document.createElement('div');
      div.className = 'm3d-anchor';
      div.innerHTML = `<div class="sector-label${hot.includes(sc.n) ? ' hot' : ''}">${sc.n}${hot.includes(sc.n) ? '<span>· риск</span>' : ''}</div>`;
      const o = new CSS2DObject(div);
      o.position.set(x(sc.west), 0.05, z(sc.north));
      this.dynamic.add(o);
    }

    // связи буёв — пунктир по воде
    const byId = Object.fromEntries(state.buoys.map((b) => [b.id, b]));
    for (const [a, b] of state.links) {
      if (!byId[a] || !byId[b]) continue;
      const alarm = byId[a].status === 'alert' || byId[b].status === 'alert';
      const l = line([x(byId[a].lon), 0.08, z(byId[a].lat), x(byId[b].lon), 0.08, z(byId[b].lat)], {
        color: new THREE.Color(alarm ? P.alert : P.ok).getHex(), linewidth: alarm ? 1.8 : 1.3, dashed: true, dashSize: 0.35, gapSize: 0.55, opacity: alarm ? 0.85 : 0.6,
      } as never);
      this.linkMats.push({ m: l.mat, o: alarm ? 0.85 : 0.6 });
    }

    // буи
    state.buoys.forEach((b, i) => this.addBuoy(b, i));

    // катер инспектора
    const [ilat, ilon] = state.inspector;
    const boat = new THREE.Group();
    boat.position.set(x(ilon), 0, z(ilat));
    const hull = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 3), new THREE.MeshLambertMaterial({ color: P.primary }));
    hull.rotation.set(-Math.PI / 2, 0, 0);
    hull.scale.set(1, 1, 0.45);
    hull.position.y = 0.18;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: P.primary, transparent: true, depthWrite: false, opacity: 0.55,
      blending: P.additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    glow.scale.setScalar(2.4);
    glow.position.y = 0.3;
    const me = document.createElement('div');
    me.className = 'm3d-tag m3d-me';
    me.innerHTML = '<span>Вы</span>';
    const meL = new CSS2DObject(me);
    meL.position.y = 0.6;
    boat.add(hull, glow, meL);
    this.inspector = boat;
    this.dynamic.add(boat);
    this.dyn.push(hull.geometry, hull.material as THREE.Material, glow.material);

    // маршрут перехвата: дуга над водой, пунктир бежит к цели
    const intercept = state.alerts.find((a) => a.status === 'intercept');
    if (intercept) {
      const [tlat, tlon] = target(intercept);                 // к оценке места по нескольким буям, если она есть
      const A = new THREE.Vector3(x(ilon), 0.2, z(ilat)), B = new THREE.Vector3(x(tlon), 0.2, z(tlat));
      const mid = A.clone().lerp(B, 0.5);
      mid.y = Math.max(1.2, A.distanceTo(B) * 0.22);
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      const pts = curve.getPoints(80).flatMap((p) => [p.x, p.y, p.z]);
      const r = line(pts, { color: new THREE.Color(P.primary).getHex(), linewidth: 2.6, dashed: true, dashSize: 0.6, gapSize: 0.45, opacity: 0.95 } as never);
      this.route = r.mat;
      const d = document.createElement('div');
      d.className = 'route-label';
      d.textContent = km(distanceKm([ilat, ilon], [tlat, tlon]));
      const o = new CSS2DObject(d);
      o.position.copy(curve.getPoint(0.5)).add(new THREE.Vector3(0, 0.4, 0));
      this.dynamic.add(o);
    }
    this.lastActive = performance.now();
  }

  private addCurtain(sc: Sector) {
    const P = this.pal, x = this.proj.x, z = this.proj.z;
    const c = [[x(sc.west), z(sc.south)], [x(sc.west), z(sc.north)], [x(sc.east), z(sc.north)], [x(sc.east), z(sc.south)]];
    const H = 3.2, pos: number[] = [], h: number[] = [], idx: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], k = pos.length / 3;
      pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], H, b[1], a[0], H, a[1]);
      h.push(0, 0, 1, 1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('h', new THREE.Float32BufferAttribute(h, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(P.warn) }, uK: { value: 0 }, uT: { value: 0 } },
      vertexShader: CURTAIN_VS, fragmentShader: CURTAIN_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: P.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // пол зоны
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(c[2][0] - c[0][0]), Math.abs(c[0][1] - c[1][1])),
      new THREE.MeshBasicMaterial({ color: P.warn, transparent: true, opacity: 0, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((c[0][0] + c[2][0]) / 2, 0.02, (c[0][1] + c[1][1]) / 2);
    this.dynamic.add(mesh, floor);
    this.curtains.push({ mat, mesh, floor: floor.material as THREE.MeshBasicMaterial });
    this.dyn.push(geo, mat, floor.geometry, floor.material as THREE.Material);
  }

  private addBuoy(b: Buoy, i: number) {
    const P = this.pal;
    const col = new THREE.Color(P[b.status === 'ok' ? 'ok' : b.status]);
    const group = new THREE.Group();
    group.position.set(this.proj.x(b.lon), 0, this.proj.z(b.lat));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.55, 28), new THREE.MeshLambertMaterial({ color: col }));
    body.position.y = 0.12;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.18, 20), new THREE.MeshLambertMaterial({ color: P.primary }));
    cap.position.y = 0.48;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.2, 8), new THREE.MeshLambertMaterial({ color: P.primary }));
    mast.position.y = 1.1;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, transparent: true, depthWrite: false,
      blending: P.additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: b.status === 'offline' ? 0 : 0.9 }));
    glow.position.y = 1.75;
    const base = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.03;
    base.scale.setScalar(0.85);
    const sel = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: P.primary, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    sel.rotation.x = -Math.PI / 2;
    sel.position.y = 0.035;
    sel.scale.setScalar(1.35);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.8;
    hit.userData.id = b.id;
    group.add(body, cap, mast, glow, base, sel, hit);
    const rings: THREE.Mesh[] = [];
    let beam: THREE.Mesh | null = null;
    if (b.status === 'alert') {
      for (let j = 0; j < 2; j++) {
        const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.04;
        rings.push(r);
        group.add(r);
        this.dyn.push(r.material as THREE.Material);
      }
      const bg = new THREE.CylinderGeometry(0.22, 0.5, 9, 20, 1, true);
      bg.translate(0, 4.5, 0);
      beam = new THREE.Mesh(bg, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: col }, uK: { value: 1 }, uT: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: P.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: 'varying float vH; void main(){ vH = position.y / 9.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uK; varying float vH; void main(){ gl_FragColor = vec4(uColor, pow(1. - vH, 2.) * .38 * uK); }',
      }));
      group.add(beam);
      this.dyn.push(bg, beam.material as THREE.Material);
    }
    const label = document.createElement('div');
    label.className = `m3d-tag${b.status === 'alert' ? ' alert' : ''}${b.status === 'offline' ? ' off' : ''}`;
    label.appendChild(document.createElement('span')).textContent = b.name;
    const lo = new CSS2DObject(label);
    lo.position.y = 1.75;
    group.add(lo);
    group.scale.setScalar(0.0001);
    this.dynamic.add(group);
    this.buoys.push({ id: b.id, status: b.status, i, group, body, glow, hit, sel, rings, beam, label, selK: 0 });
    this.dyn.push(body.geometry, body.material as THREE.Material, cap.geometry, cap.material as THREE.Material, mast.geometry,
      mast.material as THREE.Material, glow.material, base.material as THREE.Material, sel.material as THREE.Material, hit.geometry, hit.material as THREE.Material);
  }

  private clearDynamic() {
    for (const o of [...this.dynamic.children]) {
      o.traverse((c) => { if (c instanceof CSS2DObject) c.element.remove(); });
      this.dynamic.remove(o);
    }
    this.dyn.forEach((d) => d.dispose());
    this.dyn = [];
    this.buoys = []; this.lines = []; this.linkMats = []; this.curtains = []; this.route = null; this.inspector = null; this.frame = null;
  }

  setSelected(id: string | null) { this.selected = id; this.lastActive = performance.now(); }
  setCompact(on: boolean) { this.host.classList.toggle('m3d-compact', on); }

  // ---------- камера ----------
  private getCam(): Cam {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sp = new THREE.Spherical().setFromVector3(off);
    return { target: this.controls.target.clone(), radius: sp.radius, phi: sp.phi, theta: sp.theta };
  }
  private setCam(c: Cam) {
    this.controls.target.copy(c.target);
    this.camera.position.copy(new THREE.Vector3().setFromSpherical(new THREE.Spherical(c.radius, c.phi, c.theta)).add(c.target));
    this.camera.lookAt(c.target);
  }
  private defaultCam(): Cam { return { target: new THREE.Vector3(0, 0, 1.5), radius: this.defRadius, phi: DEF.phi, theta: DEF.theta }; }
  /** Гасит инерцию жеста: иначе после пролёта камеры остаток вращения или сдвига доезжает и уводит вид */
  private stopInertia() {
    const c = this.controls as unknown as { _sphericalDelta?: THREE.Spherical; _panOffset?: THREE.Vector3; _scale?: number };
    c._sphericalDelta?.set(0, 0, 0);
    c._panOffset?.set(0, 0, 0);
    if (c._scale != null) c._scale = 1;
  }
  private flyCam(to: Cam, ms: number) {
    this.stopInertia();
    const from = this.getCam();
    // поворот по кратчайшему пути
    let dt = to.theta - from.theta;
    dt = ((dt + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.tween = { from, to: { ...to, theta: from.theta + dt }, t0: performance.now(), ms };
  }
  private zoomBy(k: number) {
    const c = this.getCam();
    this.flyCam({ ...c, radius: Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, c.radius * k)) }, 450);
  }
  private clampTarget() {
    const t = this.controls.target, hx = this.half.x * 0.92, hz = this.half.y * 0.92;
    const cx = Math.min(hx, Math.max(-hx, t.x)), cz = Math.min(hz, Math.max(-hz, t.z));
    if (cx !== t.x || cz !== t.z || t.y !== 0) {
      const d = new THREE.Vector3(cx - t.x, -t.y, cz - t.z);
      t.add(d);
      this.camera.position.add(d);
    }
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.lines) m.resolution.set(w, h);
    // весь район в кадре с запасом под кнопки и легенду
    const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    this.defRadius = Math.max((this.half.x * 1.08) / (tan * this.camera.aspect), (this.half.y * 1.5) / tan) * 1.16;
    this.setCompact(w < 640);
    this.lastActive = performance.now();
  }

  // ---------- указатель ----------
  private pickAt(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects(this.buoys.map((b) => b.hit), false);
    return hits[0]?.object.userData.id as string | undefined;
  }
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5 || performance.now() - this.down.t > 600) return;
    this.opts.onSelect(this.pickAt(e) ?? null);
  };
  private onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const id = this.pickAt(e) ?? null;
    const r = this.host.getBoundingClientRect();
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.hoverId = id;
    this.opts.onHover(id ? { id, x: e.clientX - r.left, y: e.clientY - r.top } : null);
  };
  private onLeave = () => { this.hoverId = null; this.opts.onHover(null); };

  // ---------- кадр ----------
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const t = (now - this.t0) / 1000;
    const busy = this.tween != null || now - this.lastActive < 1200 || t < 4;
    if (now - this.last < (busy ? 1000 / 60 : 1000 / 30) - 3) return;
    this.last = now;

    if (this.tween) {
      const { from, to, t0, ms } = this.tween;
      const k = easeInOut(clamp01((now - t0) / ms));
      this.setCam({
        target: from.target.clone().lerp(to.target, k),
        radius: Math.exp(Math.log(from.radius) + (Math.log(to.radius) - Math.log(from.radius)) * k),
        phi: from.phi + (to.phi - from.phi) * k, theta: from.theta + (to.theta - from.theta) * k,
      });
      if (k >= 1) this.tween = null;
      this.lastActive = now;
      this.stopInertia();
    }
    this.controls.update();
    const dist = this.camera.position.distanceTo(this.controls.target);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.1; fog.far = dist * 3.2;

    // проявление плиты и слоёв при открытии
    const gu = this.ground.material.uniforms;
    gu.uT.value = t;
    gu.uReveal.value = t < 2.2 ? easeOut(clamp01((t - 0.15) / 1.7)) * 1.05 : 5;
    if (this.frame) {
      const k = easeOut(clamp01((t - 0.5) / 1.6));
      (this.frame.line.geometry as LineGeometry).instanceCount = Math.max(1, Math.round(this.frame.segs * k));
      if (k >= 1) this.frame = null;
    }
    const fadeK = easeOut(clamp01((t - 1.1) / 1.0));
    for (const { m, o } of this.linkMats) m.opacity = o * fadeK;
    if (this.route) this.route.dashOffset -= 0.04;
    for (const c of this.curtains) {
      const k = easeOut(clamp01((t - 1.6) / 1.1));
      c.floor.opacity = 0.1 * k;
      c.mat.uniforms.uK.value = k * (0.85 + 0.15 * Math.sin(t * 1.4));
      c.mat.uniforms.uT.value = t;
      c.mesh.scale.y = 0.0001 + easeOut(clamp01((t - 1.6) / 1.1));
    }
    // буи и катер: одинаковый размер на экране на любом масштабе, появление по очереди, выделение плавно
    const H = this.host.clientHeight || 1, tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    const wp = new THREE.Vector3();
    if (this.inspector) {
      this.inspector.position.y = 0.05 * Math.sin(t * 1.8);
      this.inspector.getWorldPosition(wp);
      const unit = (17 * 2 * wp.distanceTo(this.camera.position) * tan) / H;
      this.inspector.scale.setScalar(Math.max(0.0001, unit * springIn(clamp01((t - 0.9) / 0.7))));
    }
    for (const b of this.buoys) {
      b.group.getWorldPosition(wp);
      const unit = (17 * 2 * wp.distanceTo(this.camera.position) * tan) / H;     // ≈17 пикселей на единицу
      const on = b.id === this.selected;
      b.selK += ((on ? 1 : 0) - b.selK) * 0.18;
      const appear = springIn(clamp01((t - 1.0 - b.i * 0.08) / 0.7));
      b.group.scale.setScalar(Math.max(0.0001, unit * appear * (1 + 0.28 * b.selK + (this.hoverId === b.id ? 0.1 : 0))));
      (b.sel.material as THREE.MeshBasicMaterial).opacity = 0.9 * b.selK;
      b.label.classList.toggle('on', on);
      if (b.status !== 'offline') {
        const breath = 0.5 + 0.5 * Math.sin(t * (b.status === 'alert' ? 3.2 : 1.1) + b.i * 1.7);
        b.glow.scale.setScalar(b.status === 'alert' ? 2.4 + 0.8 * breath : 1.5 + 0.35 * breath);
        // днём огонёк едва виден, как настоящий; ночью — светится
        b.glow.material.opacity = (b.status === 'alert' ? 0.75 + 0.25 * breath : 0.55 + 0.35 * breath) * (b.status === 'alert' ? 1 : this.pal.glowK);
      }
      b.rings.forEach((r, j) => {
        const p = (t * 0.45 + j * 0.5) % 1;
        r.scale.setScalar(1 + 5 * easeOut(p));
        (r.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p) * appear;
      });
      if (b.beam) (b.beam.material as THREE.ShaderMaterial).uniforms.uK.value = (0.7 + 0.3 * Math.sin(t * 3.2)) * appear;
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerleave', this.onLeave);
    this.clearDynamic();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
    this.labels.domElement.remove();
  }
}

interface Cam { target: THREE.Vector3; radius: number; phi: number; theta: number }
