"""Погода над районом: ветер и температура воды из Open-Meteo (без ключа), с запасным вариантом.

Ветер — прогноз и архив по часам (на 16 дней вперёд и 60 назад): штиль облегчает выход на лодке.
Вода — температура поверхности моря у кромки авандельты (морской API Open-Meteo): нерестовое окно.
Обновление раз в 30 минут в фоне. Нет сети — прогноз считается по сезонной модели, как раньше,
и интерфейс это видит (source = seasonal).
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Callable

from .models import Weather

log = logging.getLogger("404.weather")

SITE = (45.73, 48.0)        # центр района: ветер
SEA = (45.35, 48.15)        # открытая вода у кромки авандельты: температура моря
FORECAST = "https://api.open-meteo.com/v1/forecast"
MARINE = "https://marine-api.open-meteo.com/v1/marine"


def _get(url: str, params: dict, timeout: float = 8) -> dict:
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{q}", headers={"User-Agent": "404-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _series(data: dict, key: str) -> dict[datetime, float]:
    h = data.get("hourly") or {}
    out = {}
    for t, v in zip(h.get("time", []), h.get(key, [])):
        if v is not None:
            out[datetime.fromisoformat(t).replace(tzinfo=timezone.utc)] = float(v)
    return out


class OpenMeteo:
    def __init__(self, fetch: Callable[[str, dict], dict] = _get):
        self.fetch = fetch
        self.wind: dict[datetime, float] = {}
        self.water: dict[datetime, float] = {}
        self.fetched_at: datetime | None = None
        self.error: str | None = None

    def refresh(self) -> bool:
        """Скачать ряды; при ошибке оставить прежние (или сезонную модель). Возвращает успех."""
        try:
            w = self.fetch(FORECAST, {"latitude": SITE[0], "longitude": SITE[1], "hourly": "wind_speed_10m",
                                      "wind_speed_unit": "ms", "past_days": 61, "forecast_days": 16, "timezone": "UTC"})
            wind = _series(w, "wind_speed_10m")
            water: dict[datetime, float] = {}
            try:
                m = self.fetch(MARINE, {"latitude": SEA[0], "longitude": SEA[1], "hourly": "sea_surface_temperature",
                                        "past_days": 61, "forecast_days": 8, "timezone": "UTC"})
                water = _series(m, "sea_surface_temperature")
            except Exception as e:  # морской API может не знать мелководье — тогда вода сезонная
                log.info("Open-Meteo: температура моря недоступна (%s)", e)
            if not wind:
                raise ValueError("пустой ответ")
            self.wind, self.water = wind, water
            self.fetched_at, self.error = datetime.now(timezone.utc), None
            return True
        except Exception as e:
            self.error = str(e)
            log.warning("Open-Meteo недоступен: %s — прогноз по сезонной модели", e)
            return False

    @staticmethod
    def _at(series: dict[datetime, float], dt: datetime) -> float | None:
        if not series:
            return None
        t = dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return series.get(t)

    def wind_at(self, dt: datetime) -> float | None:
        return self._at(self.wind, dt)

    def water_at(self, dt: datetime) -> float | None:
        return self._at(self.water, dt)

    def status(self, now: datetime, wind_default: float, water_default: float) -> Weather:
        w, t = self.wind_at(now), self.water_at(now)
        return Weather(source="open-meteo" if w is not None else "seasonal", fetched_at=self.fetched_at,
                       wind_ms=round(w if w is not None else wind_default, 1), water_temp=round(t if t is not None else water_default, 1))
