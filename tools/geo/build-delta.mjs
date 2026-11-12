// Офлайн-подложка дельты Волги: суша Natural Earth land 10m (Каспий — «дыра» в Евразии).
// Рукава в Natural Earth — мелкие фрагменты и на схеме дают «осколки»; детальные русла — в режиме «Карта».
// Результат: web/public/geo/volga-delta.geojson
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../web/public/geo/volga-delta.geojson');
const BOX = [47.2, 45.3, 48.9, 46.35]; // lon0, lat0, lon1, lat1

const r5 = n => Math.round(n * 1e5) / 1e5;

// отсечение кольца прямоугольником (Сазерленд — Ходжмен)
function clipRing(ring) {
  const edges = [
    p => p[0] >= BOX[0], p => p[0] <= BOX[2], p => p[1] >= BOX[1], p => p[1] <= BOX[3],
  ];
  const cross = [
    (a, b) => { const t = (BOX[0] - a[0]) / (b[0] - a[0]); return [BOX[0], a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (BOX[2] - a[0]) / (b[0] - a[0]); return [BOX[2], a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (BOX[1] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), BOX[1]]; },
    (a, b) => { const t = (BOX[3] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), BOX[3]]; },
  ];
  let out = ring;
  for (let e = 0; e < 4; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = edges[e](cur), pi = edges[e](prev);
      if (ci) { if (!pi) out.push(cross[e](prev, cur)); out.push(cur); }
      else if (pi) out.push(cross[e](prev, cur));
    }
    if (!out.length) return null;
  }
  out = out.map(([x, y]) => [r5(x), r5(y)]);
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}
const touches = ring => ring.some(([x, y]) => x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3]);

// суша
const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-10m.json')));
const land = feature(topo, topo.objects.land);
const landPolys = [];
for (const f of land.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    if (!poly.some(touches) && !poly[0].some(([x, y]) => x < BOX[0]) ) continue;
    const rings = poly.map(clipRing).filter(Boolean);
    if (rings.length && rings[0].length > 3) landPolys.push(rings);
  }
}

const fc = {
  type: 'FeatureCollection',
  bbox: BOX,
  features: [
    { type: 'Feature', properties: { kind: 'land', source: 'Natural Earth land 10m' }, geometry: { type: 'MultiPolygon', coordinates: landPolys } },
  ],
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fc));
console.log('land polys', landPolys.length, 'bytes', fs.statSync(OUT).size);
