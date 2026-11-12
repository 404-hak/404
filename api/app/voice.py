"""Голос системы: не робот, а напарник (брендбук, раздел 7.3)."""
from __future__ import annotations

from datetime import date

MONTHS_GEN = ["", "января", "февраля", "марта", "апреля", "мая", "июня", "июля",
              "августа", "сентября", "октября", "ноября", "декабря"]
WEEKDAY_ACC = ["в понедельник", "во вторник", "в среду", "в четверг",
               "в пятницу", "в субботу", "в воскресенье"]


def km(d: float) -> str:
    return f"{d:.1f}".replace(".", ",") + "\u00a0км"


def when(d: date, today: date) -> str:
    delta = (today - d).days
    if delta <= 0:
        return "сегодня"
    if delta == 1:
        return "вчера"
    if delta < 7:
        return WEEKDAY_ACC[d.weekday()]
    return f"{d.day} {MONTHS_GEN[d.month]}"


def alert_message(kind: str, buoy: str, distance_km: float | None,
                  match_seen: date | None, match_pct: int | None, today: date) -> str:
    dist = f" {km(distance_km)} от вас." if distance_km is not None else ""
    if kind == "motor":
        m = (f" Похоже на тот же катер, что был здесь {when(match_seen, today)} ({match_pct}\u00a0%)."
             if match_seen and match_pct else " Катер раньше не встречался.")
        return f"Буй {buoy} услышал мотор.{m}{dist}"
    if kind == "shot":
        return f"Буй {buoy}: похоже на выстрел.{dist}"
    if kind == "silence":
        return f"У буя {buoy} замолчала природа: лягушки и птицы стихли. Рядом может быть человек.{dist}"
    if kind == "offline":
        return f"Буй {buoy} не выходит на связь. Соседние буи прикрывают зону.{dist}"
    return f"Буй {buoy}: событие «{kind}».{dist}"
