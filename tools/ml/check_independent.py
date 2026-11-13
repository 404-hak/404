"""Проверка сети на звуках, которых не делал наш синтезатор: что она скажет «живому» микрофону.

    .venv/bin/python check_independent.py            # из tools/ml; речь — через espeak-ng, если он установлен
                                                      # (sudo apt-get install espeak-ng)

Наборы:
  комната     — цифровая тишина, белый и розовый шум, гул сети 50 Гц, гул + шум, «вентилятор»: ждём фон,
                не голоса и не мотор;
  речь        — фразы espeak-ng тремя голосами: ждём «голоса» (или хотя бы не тревогу);
  звуки ртом  — «пф», «бах», «тыщ», «бррр», «бр бр бр», «вжжж», «тр тр тр» от espeak-ng: ждём не тревогу.
Каждый звук кладётся в 4-секундный клип на тихий шум, как при записи микрофоном; «тревога» —
как решило бы ухо буя по двум таким клипам подряд (мотору нужно два).
"""
from __future__ import annotations

import shutil
import subprocess
import wave
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
from app.audio import dsp  # noqa: E402
from app.audio.listener import Ear, hear  # noqa: E402
from app.audio.model import load  # noqa: E402

SR, N = dsp.SR, dsp.SR * 4
PHRASES = ["проверка связи, приём", "смотри, вон там лодка у камыша", "давай быстрее, уходим отсюда", "ну что, поехали домой"]
MOUTH = ["пф", "пф пф", "бах", "бах бах", "тыщ", "пиу пиу", "брррррр", "бр бр бр", "дррррр", "вжжжжжж", "ррррррр", "тр тр тр тр", "ммммммм", "кхх"]


def clip(sig: np.ndarray, r: np.random.Generator, at: float = 0.8, floor_db: float = -48) -> np.ndarray:
    x = r.normal(0, 10 ** (floor_db / 20), N)
    s = sig[: N - int(at * SR)]
    x[int(at * SR):int(at * SR) + len(s)] += s / (np.abs(s).max() + 1e-9) * 0.5
    return x


def room_set(r: np.random.Generator) -> list[tuple[str, np.ndarray]]:
    t = np.arange(N) / SR
    white = r.normal(0, 1, N)
    pink = np.fft.irfft(np.fft.rfft(r.normal(0, 1, N)) / np.sqrt(np.arange(N // 2 + 1) + 1), N)
    hum = sum(np.sin(2 * np.pi * 50 * k * t) / k for k in range(1, 9))
    fan = np.fft.irfft(np.fft.rfft(r.normal(0, 1, N)) / (1 + (np.fft.rfftfreq(N, 1 / SR) / 400) ** 2), N) + 0.3 * np.sin(2 * np.pi * 140 * t)
    return [("цифровая тишина", r.normal(0, 1e-4, N)), ("белый шум", white * 0.01), ("розовый шум", pink / np.abs(pink).max() * 0.05),
            ("гул сети 50 Гц", hum * 0.02), ("гул + шум", hum * 0.02 + white * 0.003), ("вентилятор", fan / np.abs(fan).max() * 0.05)]


def espeak(text: str, voice: str, speed: int, pitch: int) -> np.ndarray | None:
    if not shutil.which("espeak-ng"):
        return None
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        subprocess.run(["espeak-ng", "-v", voice, "-s", str(speed), "-p", str(pitch), "-w", f.name, text], check=True, capture_output=True)
        with wave.open(f.name) as w:                       # espeak пишет 22 050 Гц, 16 бит; короткие звуки — меньше секунды
            sr, raw = w.getframerate(), w.readframes(w.getnframes())
    y = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    if len(y) < sr * 0.1:
        return None
    t = np.arange(int(len(y) * SR / sr)) / SR
    return np.interp(t, np.arange(len(y)) / sr, y)


def main() -> None:
    m = load()
    if not m:
        sys.exit("нет модели: сначала train.py")
    t = m.meta["thresholds"]                                # микрофон в воздухе — его пороги (если модель их знает)
    sfx = "_air" if "shot_air" in t else ""
    th = {"motor": t["motor" + sfx], "shot": t["shot" + sfx]}
    print(f"пороги микрофона: мотор {th['motor']:.4f}, выстрел {th['shot']:.4f}")
    r = np.random.default_rng(404)
    sets: dict[str, list[tuple[str, np.ndarray]]] = {"комната": room_set(r), "речь": [], "звуки ртом": []}
    for name, texts in (("речь", PHRASES), ("звуки ртом", MOUTH)):
        for text in texts:
            for v, sp, pi in (("ru", 150, 50), ("ru+f3", 170, 70), ("ru+m3", 130, 35)):
                s = espeak(text, v, sp, pi)
                if s is not None:
                    sets[name].append((f"«{text}» {v}", clip(s, r)))
    if not sets["речь"]:
        print("espeak-ng не установлен — проверяю только комнату")
    total = {}
    for name, items in sets.items():
        if not items:
            continue
        print(f"\n{name}:")
        cnt = {"voice": 0, "background": 0, "motor": 0, "shot": 0, "тревог": 0, "непривычно": 0}
        for label, x in items:
            a = m.analyze(x.astype(np.float32))
            ear, t0 = Ear(), datetime(2026, 1, 1, tzinfo=timezone.utc)
            kinds = [hear(ear, a, th, t0 + timedelta(seconds=4 * i))[0] for i in range(2)]
            alarm = next((k for k in kinds if k), None)
            cnt[a.event] += 1
            cnt["тревог"] += alarm is not None
            cnt["непривычно"] += a.unfamiliar
            print(f"  {label:34s} {a.event:10s} {a.confidence:5.2f}  непривычность {a.novelty:4.1f}  {'ТРЕВОГА: ' + alarm if alarm else ''}")
        total[name] = (len(items), cnt)
    print("\nитог:")
    for name, (n, c) in total.items():
        print(f"  {name:11s} {n:3d} звуков: голоса {c['voice']}, фон {c['background']}, мотор {c['motor']}, выстрел {c['shot']}; "
              f"тревог {c['тревог']}, непривычных {c['непривычно']}")


if __name__ == "__main__":
    main()
