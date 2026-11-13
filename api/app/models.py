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
    audio_sha256: str | None = Field(default=None, description="SHA-256 звукового клипа-улики (входит в хэш алерта)")
    probs: dict[str, float] | None = Field(default=None, description="Ответ нейросети по классам для этого клипа")
    source: Literal["audio", "manual", "system"] = Field(default="manual", description="audio — нейросеть по звуку буя; system — связь, тишина")


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
    weather: Literal["open-meteo", "seasonal"] = Field(default="seasonal", description="Откуда ветер и вода: измерения/прогноз или сезонная модель")


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
    audio_checked: int = Field(default=0, description="Сколько звуковых улик сверено с их SHA-256")
    reason: str | None = None


class ClipResult(BaseModel):
    """Что нейросеть услышала в клипе буя и что из этого вышло."""
    sha256: str
    buoy_id: str
    ts: datetime
    event: Literal["background", "motor", "shot", "voice"]
    confidence: float
    probs: dict[str, float]
    activity: float = Field(description="Живость природы 0–1 (лягушки, птицы, насекомые)")
    level_db: float
    f0_hz: float | None = Field(default=None, description="Частота вращения мотора по гармоникам")
    novelty: float = Field(default=0.0, description="Непривычность звука для сети: больше 1 — на таком она не училась")
    alert: Alert | None = None
    note: str = Field(description="Почему создан или не создан алерт")


class Heartbeat(BaseModel):
    battery: int | None = Field(default=None, ge=0, le=100)
    temp_c: float | None = None


class ModelInfo(BaseModel):
    available: bool
    meta: dict | None = None


class Weather(BaseModel):
    source: Literal["open-meteo", "seasonal"]
    fetched_at: datetime | None
    wind_ms: float
    water_temp: float


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
    wind_ms: float = 4.0
    weather: Literal["open-meteo", "seasonal"] = "seasonal"
