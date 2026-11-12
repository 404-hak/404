"""Демо-район: авандельта и нижние рукава дельты Волги.

Координаты буёв — демонстрационные, но стоят на настоящей воде: в море у берега дельты
или в руслах рек и каналов по данным OpenStreetMap (tools/geo/build_osm.py подбирает
ближайшую воду в том же секторе, tests/test_api.py проверяет). Реальные точки
заповедника — задача Фазы 0 (уточнить у заказчика).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# Сетка 3×3 секторов: 1–3 — север, 7–9 — юг (кромка авандельты)
AREA = {"lat0": 45.55, "lat1": 45.95, "lon0": 47.60, "lon1": 48.40}
ROWS = COLS = 3
D_LAT = (AREA["lat1"] - AREA["lat0"]) / ROWS
D_LON = (AREA["lon1"] - AREA["lon0"]) / COLS

# Центр карты и позиция катера инспектора в демо
MAP_CENTER = (45.73, 48.00)
INSPECTOR = (45.6264, 47.7321)


@dataclass(frozen=True)
class BuoySeed:
    id: str
    name: str
    lat: float
    lon: float


BUOYS: list[BuoySeed] = [
    BuoySeed("b01", "Осетровый-1", 45.6727, 47.7048),
    BuoySeed("b02", "Ериковый-2", 45.7770, 47.6931),
    BuoySeed("b03", "Тростниковый-3", 45.6893, 47.9513),
    BuoySeed("b04", "Камышовый-4", 45.6099, 47.7701),
    BuoySeed("b05", "Протоковый-5", 45.8001, 48.0103),
    BuoySeed("b06", "Чаячий-6", 45.6932, 48.2532),
    BuoySeed("b07", "Бакланий-7", 45.7893, 48.3098),
    BuoySeed("b08", "Култучный-8", 45.6200, 48.3000),
    BuoySeed("b09", "Мелководный-9", 45.5552, 47.8256),
    BuoySeed("b10", "Лотосовый-10", 45.8803, 48.2715),
]


def sector_of(lat: float, lon: float) -> int:
    r = min(ROWS - 1, max(0, int((AREA["lat1"] - lat) / D_LAT)))
    c = min(COLS - 1, max(0, int((lon - AREA["lon0"]) / D_LON)))
    return r * COLS + c + 1


def sector_bounds(n: int) -> tuple[tuple[float, float], tuple[float, float]]:
    """((юг, запад), (север, восток))"""
    r, c = divmod(n - 1, COLS)
    north = AREA["lat1"] - r * D_LAT
    west = AREA["lon0"] + c * D_LON
    return (round(north - D_LAT, 5), round(west, 5)), (round(north, 5), round(west + D_LON, 5))


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def nerve_links(k: int = 2) -> list[tuple[str, str]]:
    """«Нервы» сети: каждый буй связан с k ближайшими соседями."""
    links: set[tuple[str, str]] = set()
    for b in BUOYS:
        near = sorted((haversine_km(b.lat, b.lon, o.lat, o.lon), o.id) for o in BUOYS if o.id != b.id)[:k]
        for _, oid in near:
            links.add(tuple(sorted((b.id, oid))))  # type: ignore[arg-type]
    return sorted(links)
