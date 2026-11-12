"""Демо-район: авандельта и нижние рукава дельты Волги.

Координаты буёв — демонстрационные: поставлены в воду и рукава по береговой линии
Natural Earth 10m. Реальные точки заповедника — задача Фазы 0 (уточнить у заказчика).
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
INSPECTOR = (45.640, 47.730)


@dataclass(frozen=True)
class BuoySeed:
    id: str
    name: str
    lat: float
    lon: float


BUOYS: list[BuoySeed] = [
    BuoySeed("b01", "Осетровый-1", 45.680, 47.720),
    BuoySeed("b02", "Ериковый-2", 45.775, 47.690),
    BuoySeed("b03", "Тростниковый-3", 45.700, 47.960),
    BuoySeed("b04", "Камышовый-4", 45.610, 47.770),
    BuoySeed("b05", "Протоковый-5", 45.800, 48.010),
    BuoySeed("b06", "Чаячий-6", 45.710, 48.260),
    BuoySeed("b07", "Бакланий-7", 45.800, 48.360),
    BuoySeed("b08", "Култучный-8", 45.620, 48.300),
    BuoySeed("b09", "Мелководный-9", 45.580, 47.860),
    BuoySeed("b10", "Лотосовый-10", 45.875, 48.270),
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
