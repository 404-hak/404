"""Ужать схему дельты без видимой разницы (docs/audit/03-performance.md, F4).

Карта приближается не дальше 13-го масштаба: там пиксель ≈ 13 м. Поэтому координаты округляются до 4 знаков (≈ 10 м)
и линии упрощаются Дугласом — Пекером с допуском ≈ 13 м — не больше пикселя на самом крупном масштабе.

    python3 tools/geo/compact.py            # переписывает web/public/geo/delta-osm.geojson
"""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "web" / "public" / "geo" / "delta-osm.geojson"
EPS = 0.00012


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    far, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
        if d > far:
            far, idx = d, i
    if far <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def simplify(pts):
    """У замкнутого кольца начало совпадает с концом — делим его в самой дальней точке и упрощаем половины."""
    if len(pts) > 3 and pts[0] == pts[-1]:
        x0, y0 = pts[0]
        k = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
        return rdp(pts[: k + 1], EPS)[:-1] + rdp(pts[k:], EPS)
    return rdp(pts, EPS)


def line(pts, ring=False):
    out = [[round(x, 4), round(y, 4)] for x, y in simplify(pts)]
    out = [p for i, p in enumerate(out) if i == 0 or p != out[i - 1]]
    if ring:
        if out[0] != out[-1]:
            out.append(out[0])
        if len(out) < 4:
            return None
    elif len(out) < 2:
        return None
    return out


def geom(g):
    t, c = g["type"], g["coordinates"]
    if t == "MultiPolygon":
        polys = [[r for r in (line(ring, True) for ring in poly) if r] for poly in c]
        g["coordinates"] = [p for p in polys if p]
    elif t == "Polygon":
        g["coordinates"] = [r for r in (line(ring, True) for ring in c) if r]
    elif t == "MultiLineString":
        g["coordinates"] = [l for l in (line(seg) for seg in c) if l]
    elif t == "LineString":
        g["coordinates"] = line(c) or c[:2]
    return g


if __name__ == "__main__":
    import sys
    sys.setrecursionlimit(100_000)
    d = json.loads(PATH.read_text())
    before = PATH.stat().st_size
    for f in d["features"]:
        geom(f["geometry"])
    PATH.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
    print(f"{before // 1024} КБ → {PATH.stat().st_size // 1024} КБ")
