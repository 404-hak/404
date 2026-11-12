"""Процедурный синтез звуков дельты — обучающие данные и звук симулятора буёв.

Настоящих записей с буёв заповедника пока нет, поэтому нейросети учатся на синтезе,
построенном по физике источников:
  мотор   — гармоники вращения коленвала, усиленные кратные частоте вспышек (цилиндры, такт),
            резонансы корпуса и выхлопа, кавитация винта, пульсирующая с частотой лопастей,
            плавание оборотов; у каждого катера своя «подпись» (по зерну) — для отпечатков;
  выстрел — дульная волна (резкий фронт, быстрый спад), реверберация и эхо от берега;
  природа — хоры лягушек (импульсные трели), птицы (частотные свисты), сверчки;
  фон     — ветер, плеск, дождь, самолёт вдали, всплеск рыбы, удар весла (сложные «не то»).
Дистанция — громкость и потеря высоких частот. Всё воспроизводимо по зерну.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .dsp import SR

CLIP_S = 4.0
N = int(SR * CLIP_S)
EVENTS = ("background", "motor", "shot")


def _t(n: int) -> np.ndarray:
    return np.arange(n) / SR


def _shape(x: np.ndarray, gain_fn) -> np.ndarray:
    """Окраска шума/сигнала через спектр: gain_fn(частоты) → множитель."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * gain_fn(f), len(x))


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def _distance(x: np.ndarray, d: float) -> np.ndarray:
    """Дальше — тише по высоким частотам (поглощение), громкость — отдельно."""
    fc = 7000 / (1 + d / 250)
    return _shape(x, lambda f: np.exp(-f / fc))


# ---------- моторы ----------
@dataclass(frozen=True)
class Vessel:
    seed: int
    cyl: int
    four_stroke: bool
    blades: int
    gear: float
    rpm: float
    res: tuple[tuple[float, float, float], ...]
    tilt: float
    cav: float
    cav_db: float
    buzz: float
    marks: tuple[float, ...]


def vessel(seed: int) -> Vessel:
    """Подпись катера по зерну: мотор, винт, корпус. Один и тот же seed — один и тот же катер."""
    r = np.random.default_rng(seed)
    cyl = int(r.choice([1, 2, 3, 4]))
    res = tuple((float(r.uniform(150, 2600)), float(r.uniform(60, 400)), float(r.uniform(4, 16))) for _ in range(int(r.integers(2, 4))))
    return Vessel(
        seed=seed, cyl=cyl, four_stroke=bool(r.random() < 0.55), blades=int(r.choice([3, 4])), gear=float(r.uniform(1.8, 2.6)),
        rpm=float(r.uniform(1300, 5200)), res=res, tilt=float(r.uniform(-9, -3)), cav=float(r.uniform(1500, 5000)),
        cav_db=float(r.uniform(-22, -8)), buzz=float(r.uniform(0, 0.6)), marks=tuple(r.normal(0, 3, 64)),
    )


def motor(v: Vessel, r: np.random.Generator, n: int = N) -> np.ndarray:
    t = _t(n)
    rpm = v.rpm * r.uniform(0.85, 1.15)
    crank = rpm / 60
    fire_mult = max(1, v.cyl // (2 if v.four_stroke else 1)) if v.cyl > 1 else 1
    drift = 1 + 0.02 * np.sin(2 * np.pi * r.uniform(0.1, 0.5) * t + r.uniform(0, 6.3)) + 0.004 * np.cumsum(r.normal(0, 1, n)) / np.sqrt(n)
    phase = 2 * np.pi * np.cumsum(crank * drift) / SR
    out = np.zeros(n)
    kmax = int(min(60, 4500 / crank))
    for k in range(1, kmax + 1):
        f = k * crank
        db = v.tilt * np.log2(k) + (9 if k % fire_mult == 0 else 0) + v.marks[k - 1] + r.normal(0, 1.2)
        db += sum(g * np.exp(-(((f - fr) / bw) ** 2)) for fr, bw, g in v.res)
        out += 10 ** (db / 20) * np.sin(k * phase + r.uniform(0, 6.3))
    out /= _rms(out)
    # винт: кавитационный шум, пульсирующий с частотой лопастей
    fb = crank / v.gear * v.blades
    noise = _shape(r.normal(0, 1, n), lambda f: np.exp(-0.5 * (np.log2((f + 1) / v.cav) / 0.7) ** 2))
    noise *= 1 + 0.7 * np.sin(2 * np.pi * fb * t + r.uniform(0, 6.3))
    out += noise / _rms(noise) * 10 ** (v.cav_db / 20)
    # выхлоп: шумовые хлопки с частотой вспышек
    if v.buzz > 0.05:
        puff = _shape(r.normal(0, 1, n), lambda f: np.exp(-f / 1800)) * (0.5 + 0.5 * np.sin(2 * np.pi * crank * fire_mult * t)) ** 4
        out += puff / _rms(puff) * v.buzz * 0.5
    # проход мимо буя: ровно, приближается, уходит или проходит рядом
    kind = r.integers(0, 4)
    if kind == 1:
        env = np.linspace(r.uniform(0.2, 0.5), 1, n)
    elif kind == 2:
        env = np.linspace(1, r.uniform(0.2, 0.5), n)
    elif kind == 3:
        c, w = r.uniform(0.2, 0.8) * CLIP_S, r.uniform(1.0, 3.0)
        env = 0.3 + 0.7 * np.exp(-0.5 * ((t - c) / w) ** 2)
    else:
        env = np.ones(n)
    return _distance(out * env, r.uniform(30, 900))


# ---------- выстрел ----------
def shot(r: np.random.Generator, n: int = N) -> np.ndarray:
    out = np.zeros(n)
    count = int(r.choice([1, 1, 1, 2, 2, 3]))
    t0 = r.uniform(0.2, CLIP_S - 1.5)
    for _ in range(count):
        i = int(t0 * SR)
        L = min(n - i, int(SR * 0.9))
        tt = np.arange(L) / SR
        blast = r.normal(0, 1, L) * np.exp(-tt / r.uniform(0.003, 0.015)) * np.minimum(1, tt / 0.0003)
        blast = _shape(blast, lambda f, fc=r.uniform(1500, 6000): 1 / (1 + (f / fc) ** 2))
        tail = r.normal(0, 1, L) * np.exp(-tt / r.uniform(0.12, 0.6)) * 10 ** (r.uniform(-24, -14) / 20)
        tail = _shape(tail, lambda f: np.exp(-f / 2500))
        s = blast / (np.abs(blast).max() + 1e-9) + tail
        for _ in range(int(r.integers(0, 3))):                      # эхо от берега
            d = int(SR * r.uniform(0.05, 0.4))
            if d < L:
                s[d:] += s[:L - d] * 10 ** (r.uniform(-16, -8) / 20)
        out[i:i + L] += s
        t0 += r.uniform(0.25, 1.2)
        if t0 > CLIP_S - 0.3:
            break
    return _distance(out, r.uniform(50, 1200))


# ---------- природа ----------
def nature(r: np.random.Generator, activity: float, n: int = N) -> np.ndarray:
    """Биофония: лягушки, птицы, сверчки; activity 0…1 — сколько их и как громко."""
    t = _t(n)
    out = np.zeros(n)
    for _ in range(int(round(activity * r.uniform(4, 9)))):            # лягушки: пульсирующие трели
        fc, rate = r.uniform(500, 2600), r.uniform(12, 55)
        call = np.zeros(n)
        pos = r.uniform(-0.5, 1.0)
        while pos < CLIP_S:
            d = r.uniform(0.2, 1.4)
            m = (t >= pos) & (t < pos + d)
            call[m] = 1
            pos += d + r.uniform(0.3, 2.5)
        pulses = np.clip(np.sin(2 * np.pi * rate * t), 0, None) ** 3
        tone = np.sin(2 * np.pi * fc * t) + 0.35 * np.sin(4 * np.pi * fc * t)
        out += tone * pulses * call * r.uniform(0.2, 1.0)
    for _ in range(int(round(activity * r.uniform(2, 10)))):           # птицы: свисты
        d = r.uniform(0.04, 0.3)
        i = int(r.uniform(0, CLIP_S - d) * SR)
        L = int(d * SR)
        tt = np.arange(L) / SR
        f1, f2 = r.uniform(2000, 7000), r.uniform(2000, 7000)
        f = f1 + (f2 - f1) * tt / d
        out[i:i + L] += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / d) ** 2 * r.uniform(0.2, 0.9)
    if r.random() < 0.3 + 0.6 * activity:                              # сверчки: высокая трель
        fc, am = r.uniform(4000, 6800), r.uniform(18, 60)
        duty = (np.sin(2 * np.pi * r.uniform(0.5, 2) * t) > r.uniform(-0.3, 0.6)).astype(float)
        out += np.sin(2 * np.pi * fc * t) * (0.5 + 0.5 * np.sin(2 * np.pi * am * t)) * duty * 0.3 * activity
    return out


def ambient(r: np.random.Generator, n: int = N) -> np.ndarray:
    """Ветер, плеск, иногда дождь и самоносный шум гидрофона."""
    t = _t(n)
    wind = _shape(r.normal(0, 1, n), lambda f: 1 / np.sqrt(f + 20) * np.exp(-f / r.uniform(400, 1500)))
    gust = 0.6 + 0.4 * np.sin(2 * np.pi * r.uniform(0.05, 0.4) * t + r.uniform(0, 6.3))
    out = wind / _rms(wind) * gust * 10 ** (r.uniform(-6, 4) / 20)
    lap = _shape(r.normal(0, 1, n), lambda f: np.exp(-0.5 * (np.log2((f + 1) / 600) / 0.8) ** 2))
    bursts = np.clip(np.sin(2 * np.pi * r.uniform(0.3, 1.2) * t + r.uniform(0, 6.3)), 0, None) ** 4
    out += lap / _rms(lap) * bursts * 10 ** (r.uniform(-14, -4) / 20)
    if r.random() < 0.15:                                                # дождь: россыпь щелчков
        rain = np.zeros(n)
        idx = r.integers(0, n, int(r.uniform(200, 2000)))
        rain[idx] = r.normal(0, 1, len(idx))
        rain = _shape(rain, lambda f: 1 / (1 + (2500 / (f + 1)) ** 2))
        out += rain / _rms(rain) * 10 ** (r.uniform(-12, -2) / 20)
    out += r.normal(0, 1, n) * 10 ** (r.uniform(-34, -24) / 20)
    return out


def distractor(r: np.random.Generator, n: int = N) -> np.ndarray:
    """Похожее на угрозу, но не угроза: самолёт вдали, всплеск рыбы, удар весла, гром."""
    t = _t(n)
    k = int(r.integers(0, 4))
    if k == 0:                                                           # самолёт: гул с доплером
        f0 = r.uniform(60, 140) * (1 + 0.04 * np.tanh((t - r.uniform(0, CLIP_S)) / 1.5))
        ph = 2 * np.pi * np.cumsum(f0) / SR
        x = sum(10 ** (-3 * k2 / 20) * np.sin(k2 * ph) for k2 in range(1, 6)) * 0.3
        x += _shape(r.normal(0, 1, n), lambda f: np.exp(-f / 500))
        return x * (0.5 + 0.5 * np.sin(np.pi * t / CLIP_S))
    i = int(r.uniform(0.2, CLIP_S - 0.6) * SR)
    L = int(SR * 0.5)
    tt = np.arange(L) / SR
    x = np.zeros(n)
    if k == 1:                                                           # всплеск рыбы: мягкий фронт, без эха
        s = r.normal(0, 1, L) * np.minimum(1, tt / r.uniform(0.008, 0.02)) * np.exp(-tt / r.uniform(0.04, 0.15))
        x[i:i + L] = _shape(s, lambda f: np.exp(-0.5 * (np.log2((f + 1) / 900) / 1.0) ** 2))
    elif k == 2:                                                         # удар весла о борт: глухой стук
        s = np.sin(2 * np.pi * r.uniform(120, 300) * tt) * np.exp(-tt / r.uniform(0.02, 0.06)) * np.minimum(1, tt / 0.002)
        x[i:i + L] = s
    else:                                                                # далёкий гром: долгий низкий раскат
        s = _shape(r.normal(0, 1, n), lambda f: np.exp(-f / 150))
        x = s * np.exp(-np.abs(t - r.uniform(0.5, 3)) / r.uniform(0.6, 1.5))
    return x


# ---------- сцена ----------
def scene(r: np.random.Generator, event: str, v: Vessel | None = None, activity: float | None = None,
          snr_db: float | None = None, n: int = N) -> tuple[np.ndarray, dict]:
    """Клип буя: фон + природа (+ событие с заданным отношением сигнал/шум). Возвращает звук и разметку."""
    act = float(r.uniform(0, 1)) if activity is None else activity
    bg = ambient(r, n)
    bio = nature(r, act, n)
    if act > 0.02:                                     # чем живее природа, тем больше голосов и тем они громче
        bg = bg + bio / (_rms(bio) + 1e-9) * _rms(bg) * 10 ** ((-16 + 22 * act + r.uniform(-2.5, 2.5)) / 20)
    meta = {"event": event, "activity": act, "vessel": v.seed if v else None}
    if event == "background" and r.random() < 0.35:
        d = distractor(r, n)
        bg = bg + d / (_rms(d) + 1e-9) * _rms(bg) * 10 ** (r.uniform(-4, 10) / 20)
    x = bg
    if event in ("motor", "shot"):
        s = motor(v or vessel(int(r.integers(1 << 30))), r, n) if event == "motor" else shot(r, n)
        snr = r.uniform(-3, 20) if snr_db is None else snr_db
        x = bg + s / _rms(s) * _rms(bg) * 10 ** (snr / 20)
        meta["snr_db"] = snr
    x = x / (np.abs(x).max() + 1e-9) * r.uniform(0.1, 0.9)
    return x.astype(np.float32), meta
