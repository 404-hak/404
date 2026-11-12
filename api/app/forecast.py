"""Лунный календарь браконьера — базовая эвристика.

В Фазе 2 формулу риска заменит обученная модель (CatBoost); интерфейс функции останется.
Фаза луны считается астрономически (синодический месяц от опорного новолуния),
температура воды — сезонная модель Северного Каспия до подключения данных Росгидромета.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone

SYNODIC = 29.530588853
REF_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)

WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]


def moon(dt: datetime) -> tuple[float, float, str]:
    """(возраст луны в днях, освещённость 0–1, название фазы)"""
    age = ((dt - REF_NEW_MOON).total_seconds() / 86400) % SYNODIC
    illum = (1 - math.cos(2 * math.pi * age / SYNODIC)) / 2
    names = ["новолуние", "растущий серп", "первая четверть", "растущая луна",
             "полнолуние", "убывающая луна", "последняя четверть", "убывающий серп"]
    idx = int(((age / SYNODIC) * 8) + 0.5) % 8
    return age, illum, names[idx]


def water_temp(d: date) -> float:
    """Сезонная модель температуры воды Северного Каспия, °C (≈1–2° зимой, ≈25° в июле)."""
    doy = d.timetuple().tm_yday
    return round(13.5 - 12.0 * math.cos(2 * math.pi * (doy - 20) / 365), 1)


@dataclass
class Conditions:
    illumination: float
    phase: str
    weekday: int
    water_temp: float
    wind_ms: float


def risk(c: Conditions) -> float:
    r = 0.12
    r += 0.35 * (1 - c.illumination)                     # темнота
    r += {4: 0.18, 5: 0.18, 6: 0.08}.get(c.weekday, 0)   # пятница, суббота, воскресенье
    if 8 <= c.water_temp <= 14:                          # нерестовое окно осетровых (упрощение)
        r += 0.20
    elif 5 <= c.water_temp <= 18:
        r += 0.08
    if c.wind_ms < 5:                                    # штиль — удобно выходить на лодке
        r += 0.07
    return round(min(0.98, max(0.02, r)), 2)


def level(r: float) -> str:
    return "high" if r >= 0.7 else "elevated" if r >= 0.4 else "low"


def moon_phrase(c: Conditions) -> str:
    if c.illumination < 0.1:
        return "Безлунная ночь"
    if c.illumination > 0.9:
        return "Полнолуние"
    return f"Луна {round(c.illumination * 100)} %"


def message(c: Conditions, r: float, hot: list[int]) -> str:
    base = f"{moon_phrase(c)}, {WEEKDAYS[c.weekday]}, вода {c.water_temp:+.0f}°."
    lv = level(r)
    if lv == "low":
        return f"{base} Риск низкий."
    tail = f" Рекомендую усилить сектор {hot[0]}." if hot and lv == "high" else ""
    return f"{base} Риск {round(r * 100)}\u00a0%.{tail}"


def conditions_for(dt_local: datetime, wind_ms: float = 4.0, water: float | None = None) -> Conditions:
    """Условия ночи; вода — измеренная (Open-Meteo), иначе сезонная модель."""
    _, illum, phase = moon(dt_local.astimezone(timezone.utc))
    w = round(water, 1) if water is not None else water_temp(dt_local.date())
    return Conditions(illum, phase, dt_local.weekday(), w, round(wind_ms, 1))
