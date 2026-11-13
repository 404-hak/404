"""Ухо буя: что делать с очередным клипом после нейросети.

Мотор — тревога, если его слышно два клипа подряд выше порога: катер не исчезает за секунды,
а случайный гул (самолёт, гром) — да; так ложных тревог на порядки меньше. Выстрел — одиночный
звук, у него свой, более строгий порог. Пороги подобраны при обучении на большом наборе фона
со сложными помехами. Катер, которого слышно минуту, — одна тревога, а не десять.

Голоса людей — не тревога: мимо проходят люди, рядом говорят и сами инспекторы. Сеть узнаёт голоса,
чтобы не путать разговор и звуки ртом («пф», «бах») с мотором и выстрелом; ухо буя только отмечает их.

«Тишина как улика»: у каждого буя своя обычная живость природы (скользящее среднее по спокойным
клипам). Если лягушки и птицы стихли — живость упала ниже 40 % обычной несколько клипов подряд, —
рядом, скорее всего, человек: тревога «тишина», даже если мотора не слышно.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .model import Analysis

COOLDOWN = {"motor": timedelta(minutes=2), "shot": timedelta(minutes=1), "silence": timedelta(minutes=10)}
PAIR_GAP = timedelta(seconds=40)   # второй клип с мотором должен прийти не позже
SILENCE_RATIO = 0.4          # тише 40 % обычного
SILENCE_MIN_BASE = 0.3       # если природа здесь и так молчит — тишина ничего не значит
SILENCE_CLIPS = 3            # столько клипов подряд
BASE_ALPHA = 0.08            # как быстро «обычная живость» подстраивается под сезон и ночь
HEALTH_ALPHA = 0.15


@dataclass
class Ear:
    baseline: float | None = None
    health: float | None = None
    quiet: int = 0
    motor_at: datetime | None = None          # прошлый клип с мотором выше порога — ждём подтверждения
    motor_fp: list[float] | None = None       # его отпечаток — чтобы сверять катер по двум клипам
    last: dict[str, datetime] = field(default_factory=dict)
    offline_alerted: bool = False


def hear(ear: Ear, an: Analysis, thresholds: dict[str, float], ts: datetime) -> tuple[str | None, float, str]:
    """→ (вид тревоги или None, уверенность, пояснение)."""
    ear.health = an.activity if ear.health is None else ear.health + (an.activity - ear.health) * HEALTH_ALPHA
    pair = ear.motor_at
    ear.motor_at = None
    if an.event == "voice":
        ear.quiet = 0
        return None, an.confidence, "голоса людей — не тревога: это могут быть инспекторы или прохожие"
    if an.event in ("motor", "shot") and an.unfamiliar:
        ear.quiet = 0
        name = "мотор" if an.event == "motor" else "выстрел"
        return None, an.confidence, (f"похоже на {name} ({an.confidence:.2f}), но звук непривычный для сети "
                                     f"(непривычность {an.novelty:.1f}) — на таком она не училась, тревогу не поднимаю")
    if an.event in ("motor", "shot"):
        ear.quiet = 0
        name = "мотор" if an.event == "motor" else "выстрел"
        threshold = thresholds[an.event]
        if an.confidence < threshold:
            return None, an.confidence, f"похоже на {name}, но уверенность {an.confidence:.2f} ниже порога {threshold:.2f}"
        if an.event == "motor" and not (pair and ts - pair <= PAIR_GAP):
            ear.motor_at = ts
            return None, an.confidence, f"мотор ({an.confidence:.2f}) — жду подтверждения следующим клипом"
        if an.event == "motor":
            ear.motor_at = ts
        last = ear.last.get(an.event)
        if last and ts - last < COOLDOWN[an.event]:
            ear.last[an.event] = ts
            return None, an.confidence, f"{name} — продолжение уже поднятой тревоги"
        ear.last[an.event] = ts
        return an.event, an.confidence, f"{name}: уверенность {an.confidence:.2f}"

    base = ear.baseline
    if base is not None and base >= SILENCE_MIN_BASE and an.activity < SILENCE_RATIO * base:
        ear.quiet += 1
        if ear.quiet >= SILENCE_CLIPS:
            last = ear.last.get("silence")
            if not last or ts - last >= COOLDOWN["silence"]:
                ear.last["silence"] = ts
                conf = round(min(0.99, 1 - an.activity / base), 2)
                return "silence", conf, f"природа стихла: живость {an.activity:.2f} при обычной {base:.2f}"
            return None, 0.0, "тишина продолжается"
        return None, 0.0, f"тише обычного ({an.activity:.2f} при {base:.2f}), слушаем дальше"
    ear.quiet = 0
    ear.baseline = an.activity if base is None else base + (an.activity - base) * BASE_ALPHA
    return None, 0.0, "фон: угроз нет"
