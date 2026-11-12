from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

AlertKind = Literal["motor", "shot", "silence", "offline"]
AlertStatus = Literal["new", "intercept", "resolved"]
BuoyStatus = Literal["ok", "warn", "alert", "offline"]
Mode = Literal["calm", "alertness", "alarm", "intercept"]


class Buoy(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    sector: int
    status: BuoyStatus = "ok"
    battery: int
    last_seen: datetime
    health: float = Field(description="Индекс здоровья по звукам природы, 0–1 (симуляция до Фазы 3)")


class Match(BaseModel):
    vessel_id: str
    last_seen: date
    similarity: float


class Alert(BaseModel):
    id: str
    buoy_id: str
    buoy_name: str
    sector: int
    kind: AlertKind
    ts: datetime
    lat: float
    lon: float
    confidence: float
    status: AlertStatus = "new"
    message: str
    distance_km: float | None = None
    match: Match | None = None
    fingerprint: list[float] | None = None
    prev_hash: str
    hash: str
    intercept_at: datetime | None = Field(default=None, description="Когда начат перехват (в хэш не входит: это обработка, не улика)")
    resolved_at: datetime | None = Field(default=None, description="Когда событие закрыто")
    synthetic: bool = Field(default=False, description="Сгенерированная демо-история, не реальное событие")


class AlertIn(BaseModel):
    buoy_id: str
    kind: AlertKind
    confidence: float = Field(ge=0, le=1)
    ts: datetime | None = None
    fingerprint: list[float] | None = Field(default=None, description="Акустический отпечаток мотора (эмбеддинг)")


class AlertPatch(BaseModel):
    status: AlertStatus


class Forecast(BaseModel):
    ts: datetime
    moon_phase: str
    moon_illumination: float
    weekday: str
    water_temp: float
    wind_ms: float
    risk: float
    level: Literal["low", "elevated", "high"]
    hot_sectors: list[int]
    message: str
    demo: bool = False


class Sector(BaseModel):
    n: int
    south: float
    west: float
    north: float
    east: float


class State(BaseModel):
    mode: Mode
    now: datetime
    buoys: list[Buoy]
    alerts: list[Alert]
    forecast: Forecast
    sectors: list[Sector]
    links: list[tuple[str, str]]
    inspector: tuple[float, float]
    center: tuple[float, float]


class ChainCheck(BaseModel):
    ok: bool
    checked: int
    broken_at: str | None = None


class NightStat(BaseModel):
    date: date
    risk: float
    moon_illumination: float
    events: int
    by_kind: dict[str, int]


class Stats(BaseModel):
    days: int
    nights: list[NightStat]
    by_kind: dict[str, int]
    by_sector: dict[int, int]
    by_hour: list[int] = Field(description="События по часу суток (местное время), 24 значения")
    total: int
    reaction_median_min: float | None = Field(description="Медиана минут от события до начала перехвата или закрытия")
    synthetic: bool = Field(description="В статистике есть сгенерированная демо-история")


class NightForecast(BaseModel):
    date: date
    weekday: str
    moon_phase: str
    moon_illumination: float
    water_temp: float
    risk: float
    level: Literal["low", "elevated", "high"]
