"""Подложка дельты Волги из OpenStreetMap и проверка, что буи стоят на воде.

1. Скачивает воду района через Overpass (зеркало maps.mail.ru — главный сервер
   не отвечает облачным машинам), тайлами и с повторами, в cache/.
2. Собирает слои:
   - sea     — море по береговой линии (natural=coastline: вода справа по ходу линии);
   - water   — озёра, ильмени, русла (natural=water, waterway=riverbank, мультиполигоны);
   - wetland — плавни и болота (natural=wetland);
   - river   — линии рек и каналов; stream — ерики, протоки, канавы.
3. Упрощает, обрезает по рамке и пишет web/public/geo/delta-osm.geojson.
4. Для каждого буя находит ближайшую точку на воде в его же секторе (не у самого берега)
   и печатает координаты для api/app/geo.py.

Данные © участники OpenStreetMap, лицензия ODbL.
Запуск: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python build_osm.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from shapely import STRtree, make_valid
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping
from shapely.ops import linemerge, nearest_points, polygonize, unary_union

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = HERE / "cache"
OUT = ROOT / "web" / "public" / "geo" / "delta-osm.geojson"
OVERPASS = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"

S, W, N, E = 45.30, 47.30, 46.20, 48.70          # рамка данных
TILES = [(45.30, 47.30, 45.75, 48.00), (45.30, 48.00, 45.75, 48.70), (45.75, 47.30, 46.20, 48.00), (45.75, 48.00, 46.20, 48.70)]

# Сетка секторов и буи — те же, что в api/app/geo.py
AREA = {"lat0": 45.55, "lat1": 45.95, "lon0": 47.60, "lon1": 48.40}
BUOYS = {
    "b01": (45.680, 47.720), "b02": (45.775, 47.690), "b03": (45.700, 47.960), "b04": (45.610, 47.770),
    "b05": (45.800, 48.010), "b06": (45.710, 48.260), "b07": (45.800, 48.360), "b08": (45.620, 48.300),
    "b09": (45.580, 47.860), "b10": (45.875, 48.270),
}
INSPECTOR = (45.640, 47.730)

QUERIES = {
    "coast": ('way["natural"="coastline"]', [(S, W, N, E)]),
    "wrels": ('relation["natural"="water"]', [(S, W, N, E)]),
    "wet": ('way["natural"="wetland"];relation["natural"="wetland"]', [(S, W, N, E)]),
    "wways": ('way["natural"="water"];way["waterway"="riverbank"]', TILES),
    "lines": ('way["waterway"~"^(river|canal|stream|ditch|drain)$"]', TILES),
}


def fetch(name: str, selector: str, bbox: tuple) -> dict:
    """Один запрос Overpass с кэшем на диске и повторами (зеркало иногда отвечает 504)."""
    key = f"{name}-{'_'.join(f'{x:.2f}' for x in bbox)}.json"
    path = CACHE / key
    if path.exists():
        return json.loads(path.read_text())
    b = ",".join(str(x) for x in bbox)
    body = ";".join(f"{part}({b})" for part in selector.split(";"))
    q = f"[out:json][timeout:240];({body};);out geom;"
    for attempt in range(5):
        try:
            req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode())
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.loads(r.read())
            CACHE.mkdir(exist_ok=True)
            path.write_text(json.dumps(data))
            return data
        except Exception as e:  # noqa: BLE001 — сеть: повторяем
            print(f"  {key}: {e}, повтор через {10 * (attempt + 1)} с", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass не ответил на {key}")


def elements(name: str) -> list[dict]:
    selector, boxes = QUERIES[name]
    seen, out = set(), []
    for bbox in boxes:
        for e in fetch(name, selector, bbox)["elements"]:
            if (e["type"], e["id"]) not in seen:
                seen.add((e["type"], e["id"]))
                out.append(e)
    return out


def coords(geom: list[dict]) -> list[tuple[float, float]]:
    return [(g["lon"], g["lat"]) for g in geom if g]


def areas(els: list[dict]):
    """Полигоны из замкнутых линий и мультиполигонов (outer минус inner)."""
    for e in els:
        if e["type"] == "way" and len(e.get("geometry", [])) >= 4:
            c = coords(e["geometry"])
            if c[0] == c[-1]:
                p = Polygon(c)
                yield p if p.is_valid else p.buffer(0)
        elif e["type"] == "relation":
            outer = [LineString(coords(m["geometry"])) for m in e.get("members", []) if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
            inner = [LineString(coords(m["geometry"])) for m in e.get("members", []) if m.get("role") == "inner" and len(m.get("geometry", [])) >= 2]
            o = unary_union(list(polygonize(unary_union(outer)))) if outer else None
            if o is None or o.is_empty:
                continue
            if inner:
                o = o.difference(unary_union(list(polygonize(unary_union(inner)))))
            yield o


RIVER_WATER = {"river", "canal", "stream", "oxbow"}


def is_river(e: dict) -> bool:
    """Русло: waterway=riverbank или natural=water с water=river/canal — вода там точно есть."""
    t = e.get("tags", {})
    return t.get("waterway") == "riverbank" or t.get("water") in RIVER_WATER


def sea_polygon(frame: Polygon):
    """Море в рамке: грани, на которые рамку режет береговая линия, лежащие справа от неё."""
    lines = [LineString(coords(e["geometry"])) for e in elements("coast") if len(e.get("geometry", [])) >= 2]
    segs = [LineString([a, b]) for ln in lines for a, b in zip(ln.coords[:-1], ln.coords[1:])]
    tree = STRtree(segs)
    merged = linemerge(lines, directed=True).intersection(frame)
    faces = list(polygonize(unary_union([merged, frame.exterior])))
    sea = []
    for f in faces:
        p = f.representative_point()
        seg = segs[tree.nearest(p)]
        (ax, ay), (bx, by) = seg.coords
        if (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax) < 0:   # справа по ходу линии — вода
            sea.append(f)
    return unary_union(sea)


def rounded(geom, nd=5):
    m = mapping(geom)

    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    m["coordinates"] = r(m["coordinates"])
    return m


def sector_box(n: int) -> Polygon:
    d_lat = (AREA["lat1"] - AREA["lat0"]) / 3
    d_lon = (AREA["lon1"] - AREA["lon0"]) / 3
    r, c = divmod(n - 1, 3)
    north = AREA["lat1"] - r * d_lat
    west = AREA["lon0"] + c * d_lon
    return box(west, north - d_lat, west + d_lon, north)


def sector_of(lat: float, lon: float) -> int:
    d_lat = (AREA["lat1"] - AREA["lat0"]) / 3
    d_lon = (AREA["lon1"] - AREA["lon0"]) / 3
    r = min(2, max(0, int((AREA["lat1"] - lat) / d_lat)))
    c = min(2, max(0, int((lon - AREA["lon0"]) / d_lon)))
    return r * 3 + c + 1


def main() -> None:
    frame = box(W, S, E, N)
    print("море…")
    sea = sea_polygon(frame)
    print("водоёмы, плавни…")
    water = unary_union([g for g in areas(elements("wrels") + elements("wways")) if not g.is_empty]).intersection(frame)
    wet = unary_union([g for g in areas(elements("wet")) if not g.is_empty]).intersection(frame).difference(water)
    print("линии…")
    big, small = [], []
    for e in elements("lines"):
        if len(e.get("geometry", [])) < 2:
            continue
        (big if e["tags"].get("waterway") in ("river", "canal") else small).append(LineString(coords(e["geometry"])))

    def clean(g, tol, min_area=0.0):
        g = make_valid(g.simplify(tol, preserve_topology=True))
        if hasattr(g, "geoms"):
            keep = [p for p in g.geoms if p.geom_type in ("Polygon", "LineString") or p.geom_type.startswith("Multi")]
            if min_area:
                keep = [p for p in keep if p.area >= min_area]
            g = unary_union(keep)
        return g

    layers = {
        "sea": clean(sea, 0.00025),
        "wetland": clean(wet, 0.0003, 4e-7),
        "water": clean(water, 0.00012, 1.5e-7),
        "river": clean(MultiLineString(big).intersection(frame), 0.00015),
        "stream": clean(MultiLineString(small).intersection(frame), 0.0002),
    }
    fc = {
        "type": "FeatureCollection",
        "bbox": [W, S, E, N],
        "attribution": "© участники OpenStreetMap, ODbL",
        "features": [{"type": "Feature", "properties": {"kind": k}, "geometry": rounded(g)} for k, g in layers.items() if not g.is_empty],
    }
    OUT.write_text(json.dumps(fc, separators=(",", ":"), ensure_ascii=False))
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} КБ")

    # Буи — только в море или в руслах рек и каналов (не в «воде» без уточнения),
    # в своём секторе и с запасом от берега.
    rels = elements("wrels") + elements("wways")
    rivers = unary_union([g for g in areas([e for e in rels if is_river(e)]) if not g.is_empty]).intersection(frame)
    inner = unary_union([sea.buffer(-0.002), rivers.buffer(-0.0004)])   # море: ~160 м от берега, русло: ~35 м
    print("\nБуи на воде (lat, lon) — для api/app/geo.py:")
    placed = {}
    for bid, (lat, lon) in {**BUOYS, "inspector": INSPECTOR}.items():
        n = sector_of(lat, lon)
        zone = inner.intersection(sector_box(n).buffer(-0.004))
        pt = Point(lon, lat)
        if zone.contains(pt):
            q = pt
        else:
            q = nearest_points(zone, pt)[0]               # на кромке безопасной зоны
        moved = pt.distance(q) * 111 * 0.7
        placed[bid] = (round(q.y, 4), round(q.x, 4))
        print(f"  {bid}: ({q.y:.4f}, {q.x:.4f})  сектор {n} → {sector_of(q.y, q.x)}  сдвиг ≈ {moved:.1f} км  "
              f"{'море' if sea.contains(q) else 'русло'}")
    (CACHE / "buoys.json").write_text(json.dumps(placed))


if __name__ == "__main__":
    main()
