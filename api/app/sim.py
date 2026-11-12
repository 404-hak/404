"""Генератор данных: такт буёв (heartbeat) и демо-сценарий для защиты.

Демо по плану: спокойная карта → «безлунная ночь, пятница, вода +12°, риск 91 %» →
буй Камышовый-4 слышит мотор того же катера, что 5 мая → перехват → закрытие.
Мотор в демо — настоящий путь звука: клип синтезируется (мотор катера boat-A у буя, ночная
природа вокруг), нейросеть его распознаёт и снимает отпечаток, архив узнаёт катер.
Переходы «Перехват» и «Закрыть» делает инспектор кнопками в интерфейсе.
"""
from __future__ import annotations

import asyncio
import os
import random
from typing import Awaitable, Callable

import numpy as np

from . import forecast as fc
from .audio import dsp, synth
from .models import AlertIn
from .world import ARCHIVE_VESSELS, World

TICK_S = float(os.getenv("SIM_TICK_S", "5"))
AMBIENT = os.getenv("SIM_AMBIENT", "0") == "1"
HEARTBEAT = os.getenv("SIM_HEARTBEAT", "1") != "0"
DEMO_CLIP_SEED = 4404
DEMO_NIGHT = fc.Conditions(illumination=0.02, phase="новолуние", weekday=4, water_temp=12.0, wind_ms=3.0)


class Sim:
    def __init__(self, world: World, publish: Callable[[], Awaitable[None]]):
        self.world = world
        self.publish = publish
        self.rnd = random.Random()
        self.demo_task: asyncio.Task | None = None

    async def run(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            self.world.tick(self.rnd, heartbeat=HEARTBEAT)
            self.world.watch()
            if AMBIENT and self.rnd.random() < 0.03:
                b = self.rnd.choice(list(self.world.buoys))
                kind = self.rnd.choice(["silence", "motor", "shot"])
                self.world.add_alert(AlertIn(buoy_id=b, kind=kind, confidence=round(self.rnd.uniform(0.7, 0.95), 2)))
            await self.publish()

    def start_demo(self, calm_s: float = 4, warn_s: float = 8) -> None:
        self.stop_demo()
        self.demo_task = asyncio.create_task(self._demo(calm_s, warn_s))

    def stop_demo(self) -> None:
        if self.demo_task and not self.demo_task.done():
            self.demo_task.cancel()

    async def _demo(self, calm_s: float, warn_s: float) -> None:
        w = self.world
        w.reset()
        await self.publish()                      # 😌 спокойствие: реальные луна и день недели
        await asyncio.sleep(calm_s)
        w.override = DEMO_NIGHT                   # ⚡ настороженность: риск 91 %, сектор 7
        await self.publish()
        await asyncio.sleep(warn_s)
        if w.model:                               # 🚨 тревога: буй слышит мотор того же катера, что 5 мая
            await asyncio.to_thread(w.ingest, "b04", demo_clip(0))   # мотор слышно — ждём второго клипа
            await self.publish()
            await asyncio.sleep(2)
            await asyncio.to_thread(w.ingest, "b04", demo_clip(1))
        else:
            fp = w.fingerprint_like("boat-A", 0.89)
            w.add_alert(AlertIn(buoy_id="b04", kind="motor", confidence=0.94, fingerprint=fp))
        await self.publish()


def demo_clip(k: int = 0) -> bytes:
    """Клип демо: мотор катера boat-A у буя Камышовый-4 на фоне ночной природы (воспроизводимо)."""
    r = np.random.default_rng(DEMO_CLIP_SEED + k)
    x, _ = synth.scene(r, "motor", v=synth.vessel(ARCHIVE_VESSELS["boat-A"]), activity=0.7, snr_db=16)
    return dsp.write_wav(x)
