"""Процедурный синтез звуков дельты — обучающие данные и звук симулятора буёв.

Настоящих записей с буёв заповедника пока нет, поэтому нейросети учатся на синтезе,
построенном по физике источников. Гидрофон буя — под водой, поэтому основная среда — вода:
  мотор   — гармоники вращения коленвала, усиленные кратные частоте вспышек (цилиндры, такт),
            резонансы корпуса и выхлопа, кавитация винта, пульсирующая с частотой лопастей;
            под водой громче всего кавитация и выхлоп (у подвесного мотора он уходит в воду);
            у каждого катера своя «подпись» (по зерну) — для отпечатков;
  выстрел — дульная волна, реверберация и эхо; в воду через поверхность она проходит глухой
            и смазанной, иногда рядом с буем в воду входит пуля — резкий удар уже в самой воде;
  голоса  — речь (форманты гласных, шипящие, взрывные), крики, смех и звуки ртом, которыми
            люди изображают выстрел: «пф», «бах», «тыщ», щелчок языком. Тревогу не поднимают;
  природа — под водой: стрекот водных насекомых, рыбы, лягушки и птицы сверху через поверхность;
            в воздухе: хоры лягушек, птицы, сверчки;
  фон     — течение, волнение, дождь по воде, волна бьёт о буй, гром, самолёт, всплеск рыбы,
            удар весла (сложные «не то»).
Мелководье дельты (1–5 м) — многолучёвость: отражение от поверхности с переворотом знака, от дна,
диффузный хвост. Звук из воздуха в воду — малая доля и в основном низкие частоты.
В воздухе (проверка микрофоном ноутбука) — иногда комнатное эхо. Всё воспроизводимо по зерну.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .dsp import SR

CLIP_S = 4.0
N = int(SR * CLIP_S)
EVENTS = ("background", "motor", "shot", "voice")
MEDIA = ("water", "air")


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


def motor(v: Vessel, r: np.random.Generator, n: int = N, water: bool = False) -> np.ndarray:
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
    out += noise / _rms(noise) * 10 ** ((v.cav_db + (8 if water else 0)) / 20)   # под водой винт слышнее всего
    # выхлоп: шумовые хлопки с частотой вспышек (у подвесного мотора под водой — через ступицу винта)
    if v.buzz > 0.05 or water:
        puff = _shape(r.normal(0, 1, n), lambda f: np.exp(-f / 1800)) * (0.5 + 0.5 * np.sin(2 * np.pi * crank * fire_mult * t)) ** 4
        out += puff / _rms(puff) * (v.buzz + (0.25 if water else 0)) * 0.5
    # проход мимо буя: ровно, приближается, уходит или проходит рядом
    kind = r.integers(0, 4)
    if kind == 1:
        env = np.linspace(r.uniform(0.2, 0.5), 1, n)
    elif kind == 2:
        env = np.linspace(1, r.uniform(0.2, 0.5), n)
    elif kind == 3:
        c, w = r.uniform(0.2, 0.8) * n / SR, r.uniform(1.0, 3.0)
        env = 0.3 + 0.7 * np.exp(-0.5 * ((t - c) / w) ** 2)
    else:
        env = np.ones(n)
    if water:                                        # в воде на этих частотах поглощение слабее, чем в воздухе
        d = r.uniform(30, 1500)
        return _shape(out * env, lambda f: np.exp(-f / (9000 / (1 + d / 700))))
    return _distance(out * env, r.uniform(30, 900))


# ---------- выстрел ----------
def shot(r: np.random.Generator, n: int = N, boom: bool = True) -> np.ndarray:
    """Выстрел в воздухе: резкая дульная волна, у ружья — мощный низ (boom), хвост и эхо от берега.
    Хлопок ладонями и щелчок такого низа не дают."""
    out = np.zeros(n)
    count = int(r.choice([1, 1, 1, 2, 2, 3]))
    dur = n / SR
    t0 = r.uniform(0.2, dur - 1.5)
    for _ in range(count):
        i = int(t0 * SR)
        L = min(n - i, int(SR * 0.9))
        tt = np.arange(L) / SR
        blast = r.normal(0, 1, L) * np.exp(-tt / r.uniform(0.003, 0.015)) * np.minimum(1, tt / 0.0003)
        blast = _shape(blast, lambda f, fc=r.uniform(1500, 6000): 1 / (1 + (f / fc) ** 2))
        low = r.normal(0, 1, L) * np.exp(-tt / r.uniform(0.01, 0.035)) * np.minimum(1, tt / 0.0008)
        low = _shape(low, lambda f, fc=r.uniform(120, 500): 1 / (1 + (f / fc) ** 4))     # дульная волна: мощный низ
        if boom:
            blast = blast / (np.abs(blast).max() + 1e-9) + low / (np.abs(low).max() + 1e-9) * r.uniform(0.5, 1.4)
        tail = r.normal(0, 1, L) * np.exp(-tt / r.uniform(0.12, 0.6)) * 10 ** (r.uniform(-24, -14) / 20)
        tail = _shape(tail, lambda f: np.exp(-f / 2500))
        s = blast / (np.abs(blast).max() + 1e-9) + tail
        for _ in range(int(r.integers(0, 3))):                      # эхо от берега
            d = int(SR * r.uniform(0.05, 0.4))
            if d < L:
                s[d:] += s[:L - d] * 10 ** (r.uniform(-16, -8) / 20)
        out[i:i + L] += s
        t0 += r.uniform(0.25, 1.2)
        if t0 > dur - 0.3:
            break
    return _distance(out, r.uniform(50, 1200))


# ---------- природа ----------
def nature(r: np.random.Generator, activity: float, n: int = N) -> np.ndarray:
    """Биофония: лягушки, птицы, сверчки; activity 0…1 — сколько их и как громко."""
    t = _t(n)
    dur = n / SR
    out = np.zeros(n)
    for _ in range(int(round(activity * r.uniform(4, 9)))):            # лягушки: пульсирующие трели
        fc, rate = r.uniform(500, 2600), r.uniform(12, 55)
        call = np.zeros(n)
        pos = r.uniform(-0.5, 1.0)
        while pos < dur:
            d = r.uniform(0.2, 1.4)
            m = (t >= pos) & (t < pos + d)
            call[m] = 1
            pos += d + r.uniform(0.3, 2.5)
        pulses = np.clip(np.sin(2 * np.pi * rate * t), 0, None) ** 3
        tone = np.sin(2 * np.pi * fc * t) + 0.35 * np.sin(4 * np.pi * fc * t)
        out += tone * pulses * call * r.uniform(0.2, 1.0)
    for _ in range(int(round(activity * r.uniform(2, 10)))):           # птицы: свисты
        d = r.uniform(0.04, 0.3)
        i = int(r.uniform(0, dur - d) * SR)
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


def ambient(r: np.random.Generator, n: int = N, rain: bool = False) -> np.ndarray:
    """Ветер, плеск, иногда дождь (rain — точно дождь) и собственный шум гидрофона."""
    t = _t(n)
    wind = _shape(r.normal(0, 1, n), lambda f: 1 / np.sqrt(f + 20) * np.exp(-f / r.uniform(400, 1500)))
    gust = 0.6 + 0.4 * np.sin(2 * np.pi * r.uniform(0.05, 0.4) * t + r.uniform(0, 6.3))
    out = wind / _rms(wind) * gust * 10 ** (r.uniform(-6, 4) / 20)
    lap = _shape(r.normal(0, 1, n), lambda f: np.exp(-0.5 * (np.log2((f + 1) / 600) / 0.8) ** 2))
    bursts = np.clip(np.sin(2 * np.pi * r.uniform(0.3, 1.2) * t + r.uniform(0, 6.3)), 0, None) ** 4
    out += lap / _rms(lap) * bursts * 10 ** (r.uniform(-14, -4) / 20)
    if r.random() < 0.15 or rain:                                        # дождь: россыпь щелчков
        rain = np.zeros(n)
        idx = r.integers(0, n, int(r.uniform(200, 2000)))
        rain[idx] = r.normal(0, 1, len(idx))
        rain = _shape(rain, lambda f: 1 / (1 + (2500 / (f + 1)) ** 2))
        out += rain / _rms(rain) * 10 ** (r.uniform(-12, -2) / 20)
    out += r.normal(0, 1, n) * 10 ** (r.uniform(-34, -24) / 20)
    return out


DISTRACTORS = ("airplane", "fish", "oar", "thunder")


def distractor(r: np.random.Generator, n: int = N, kind: str | None = None) -> np.ndarray:
    """Похожее на угрозу, но не угроза: самолёт вдали, всплеск рыбы, удар весла, гром."""
    t = _t(n)
    dur = n / SR
    k = int(r.integers(0, 4)) if kind is None else DISTRACTORS.index(kind)
    if k == 0:                                                           # самолёт: гул с доплером
        f0 = r.uniform(60, 140) * (1 + 0.04 * np.tanh((t - r.uniform(0, dur)) / 1.5))
        ph = 2 * np.pi * np.cumsum(f0) / SR
        x = sum(10 ** (-3 * k2 / 20) * np.sin(k2 * ph) for k2 in range(1, 6)) * 0.3
        x += _shape(r.normal(0, 1, n), lambda f: np.exp(-f / 500))
        return x * (0.5 + 0.5 * np.sin(np.pi * t / dur))
    i = int(r.uniform(0.2, dur - 0.6) * SR)
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



# ---------- вода: гидрофон под водой ----------
def _conv(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    L = len(x) + len(h) - 1
    nf = 1 << (L - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(h, nf), nf)[: len(x)]


def multipath(x: np.ndarray, r: np.random.Generator) -> np.ndarray:
    """Мелководье дельты (1–5 м): прямой путь, отражение от поверхности с переворотом знака,
    от дна, повторные отражения и диффузный хвост — звук размазывается на десятки миллисекунд."""
    L = int(SR * 0.16)
    h = np.zeros(L)
    h[0] = 1.0
    h[max(1, int(r.uniform(0.0006, 0.004) * SR))] -= r.uniform(0.6, 0.95)          # поверхность: знак меняется
    h[int(r.uniform(0.002, 0.012) * SR)] += r.uniform(0.3, 0.7)                     # дно
    for _ in range(int(r.integers(2, 6))):
        d = r.uniform(0.005, 0.06)
        h[int(d * SR)] += float(r.choice([-1, 1])) * r.uniform(0.1, 0.35) * np.exp(-d / 0.03)
    k = np.arange(L) / SR
    h += r.normal(0, 1, L) * np.exp(-k / r.uniform(0.015, 0.06)) * 10 ** (r.uniform(-22, -12) / 20)
    return _conv(x, h)


def to_water(x: np.ndarray, r: np.random.Generator, loss_db: float | None = None, fc: float | None = None) -> np.ndarray:
    """Звук из воздуха в воду: через поверхность проходит малая доля, в основном низкие частоты."""
    fc = r.uniform(600, 2200) if fc is None else fc
    y = _shape(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** 4))
    return multipath(y, r) * 10 ** ((r.uniform(-32, -20) if loss_db is None else loss_db) / 20)


def hydro_ambient(r: np.random.Generator, n: int = N, rain: bool = False) -> np.ndarray:
    """Фон гидрофона: обтекание и течение (низкий гул), волнение поверхности, собственный шум,
    иногда дождь по воде — шипение и щелчки капель."""
    t = _t(n)
    flow = _shape(r.normal(0, 1, n), lambda f, fc=r.uniform(25, 80): 1 / (1 + (f / fc) ** 2))
    flow *= 0.7 + 0.3 * np.sin(2 * np.pi * r.uniform(0.1, 0.6) * t + r.uniform(0, 6.3))
    surf = _shape(r.normal(0, 1, n), lambda f: (f > 20) / np.sqrt(1 + (f / 500) ** 1.7))
    out = flow / _rms(flow) * 10 ** (r.uniform(-6, 6) / 20) + surf / _rms(surf) * 10 ** (r.uniform(-14, -2) / 20)
    if r.random() < 0.12 or rain:
        drops = np.zeros(n)
        idx = r.integers(0, n, int(r.uniform(800, 5000)))
        drops[idx] = r.normal(0, 1, len(idx))
        drops = _shape(drops, lambda f: (f / 3000) ** 2 / (1 + (f / 3000) ** 2))
        hiss = _shape(r.normal(0, 1, n), lambda f: (f / 1500) / (1 + f / 1500))
        out += drops / _rms(drops) * 10 ** (r.uniform(-10, 0) / 20) + hiss / _rms(hiss) * 10 ** (r.uniform(-12, -2) / 20)
    out += r.normal(0, 1, n) * 10 ** (r.uniform(-34, -24) / 20)
    return out


def nature_water(r: np.random.Generator, activity: float, n: int = N) -> np.ndarray:
    """Природа под водой: стрекот водных насекомых (трели щелчков 2,5–7 кГц), хрюканье рыб;
    лягушки и птицы сверху — через поверхность, тише и глуше."""
    t = _t(n)
    dur = n / SR
    out = np.zeros(n)
    for _ in range(int(round(activity * r.uniform(2, 7)))):
        fc, rate = r.uniform(2500, 7000), r.uniform(25, 140)
        bout = np.zeros(n)
        pos = r.uniform(-0.3, dur)
        while pos < dur:
            d = r.uniform(0.2, 1.5)
            bout[(t >= pos) & (t < pos + d)] = 1
            pos += d + r.uniform(0.3, 2.5)
        clicks = (np.sin(2 * np.pi * rate * t + r.uniform(0, 6.3)) > 0.97).astype(float)
        clicks = _shape(clicks, lambda f, fc=fc: np.exp(-0.5 * (np.log2((f + 1) / fc) / 0.4) ** 2))
        out += clicks / (_rms(clicks) + 1e-9) * bout * r.uniform(0.1, 0.6)
    for _ in range(int(round(activity * r.uniform(0, 3)))):
        i = int(r.uniform(0, max(0.01, dur - 0.6)) * SR)
        f0 = r.uniform(80, 300)
        for j in range(int(r.integers(1, 6))):
            L = int(r.uniform(0.02, 0.06) * SR)
            tt = np.arange(L) / SR
            a = i + j * int(r.uniform(0.05, 0.12) * SR)
            if a + L < n:
                out[a:a + L] += np.sin(2 * np.pi * f0 * tt) * np.sin(np.pi * tt / (L / SR)) ** 2 * r.uniform(0.2, 0.8)
    air = nature(r, activity, n)
    if _rms(air) > 1e-6:
        out = out + to_water(air, r, loss_db=0, fc=r.uniform(1500, 4000)) / _rms(air) * (_rms(out) + 0.05) * r.uniform(0.5, 1.5)
    return out


def wave_slap(r: np.random.Generator, n: int = N) -> np.ndarray:
    """Волна бьёт о корпус буя: глухие удары каждые 1–4 с — очень близко к гидрофону."""
    out = np.zeros(n)
    dur = n / SR
    pos = r.uniform(0, 1.5)
    while pos < dur:
        L = int(0.25 * SR)
        tt = np.arange(L) / SR
        s = np.sin(2 * np.pi * r.uniform(90, 350) * tt) * np.minimum(1, tt / r.uniform(0.004, 0.015)) * np.exp(-tt / r.uniform(0.03, 0.09))
        s += _shape(r.normal(0, 1, L), lambda f: np.exp(-f / 1200)) * np.exp(-tt / 0.02) * 0.3 * np.minimum(1, tt / 0.005)
        i = int(pos * SR)
        m = min(L, n - i)
        out[i:i + m] += s[:m] * r.uniform(0.5, 1.0)
        pos += r.uniform(1.0, 4.0)
    return multipath(out, r)


def thunder(r: np.random.Generator, n: int = N) -> np.ndarray:
    """Гром: медленное нарастание (десятки–сотни мс) и долгий низкий раскат на секунды."""
    t = _t(n)
    dur = n / SR
    c = r.uniform(0.3, max(0.4, dur - 0.5))
    rise, fall = r.uniform(0.08, 0.4), r.uniform(0.6, 2.0)
    env = np.where(t < c, np.exp(-(((c - t) / rise) ** 2)), np.exp(-(t - c) / fall))
    rum = _shape(r.normal(0, 1, n), lambda f, fc=r.uniform(80, 250): 1 / (1 + (f / fc) ** 3))
    return rum * env * (0.6 + 0.4 * np.abs(np.sin(2 * np.pi * r.uniform(1, 4) * t)))


def shot_water(r: np.random.Generator, n: int = N) -> np.ndarray:
    """Выстрел, как его слышит гидрофон: дульная волна через поверхность (глухо, смазано отражениями);
    иногда пуля входит в воду рядом с буем — резкий удар и схлопывание каверны уже в самой воде."""
    air = shot(r, n, boom=False)      # низ дульной волны под водой тонет в гуле и плеске: важны резкость и пуля
    y = to_water(air, r, loss_db=0, fc=r.uniform(800, 3000))
    if r.random() < 0.5:
        i = int(np.argmax(np.abs(air))) + int(r.uniform(0.0, 0.08) * SR)
        L = int(0.05 * SR)
        if i + L < n:
            tt = np.arange(L) / SR
            imp = r.normal(0, 1, L) * np.exp(-tt / r.uniform(0.0008, 0.003))
            imp += np.sin(2 * np.pi * r.uniform(300, 1500) * tt) * np.exp(-tt / r.uniform(0.005, 0.02)) * 0.6
            imp = multipath(imp, r)
            y[i:i + L] += imp / (np.abs(imp).max() + 1e-9) * np.abs(y).max() * r.uniform(0.5, 2.0)
    return y


# ---------- голоса людей ----------
VOWELS = {"а": (730, 1090, 2440), "о": (570, 840, 2410), "у": (300, 870, 2240), "и": (270, 2290, 3010),
          "э": (530, 1840, 2480), "ы": (320, 1500, 2400)}
FRIC = {"с": (4800, 0.35), "ш": (2900, 0.45), "щ": (3800, 0.45), "ф": (2600, 1.3), "х": (1600, 0.7), "з": (4500, 0.4)}
PLOS = {"п": 900, "т": 4000, "к": 2000, "б": 700, "д": 3500, "г": 1600}


def _env(L: int, a: float, d: float) -> np.ndarray:
    t = np.arange(L) / SR
    return np.clip(np.minimum(t / max(a, 1e-4), (L / SR - t) / max(d, 1e-4)), 0, 1)


def _vowel(r, f0: float, dur: float, F, scale: float, tilt: float = 1.0, F2: tuple | None = None) -> np.ndarray:
    """Гласная: голосовой источник (гармоники основного тона) через форманты рта; F2 — скольжение к другой гласной."""
    L = max(8, int(dur * SR))
    t = np.arange(L) / SR
    f0t = f0 * (1 + r.uniform(-0.15, 0.12) * t / dur) * (1 + 0.012 * np.sin(2 * np.pi * r.uniform(4, 7) * t))
    ph = 2 * np.pi * np.cumsum(f0t) / SR
    y = np.zeros(L)
    mix = np.linspace(0, 1, L) if F2 else None
    for k in range(1, int(min(45, 4500 / f0)) + 1):
        fk = k * f0
        def g(Fs):
            return sum(a / (1 + ((fk - Fi * scale) / bw) ** 2) for Fi, a, bw in zip(Fs, (1.0, 0.55, 0.28), (90, 120, 170)))
        amp = g(F) if F2 is None else g(F) * (1 - mix) + g(F2) * mix
        y += k ** -tilt * (amp + 0.02) * np.sin(k * ph + r.uniform(0, 6.3))
    y = y / _rms(y) * _env(L, 0.02, 0.04)
    breath = _shape(r.normal(0, 1, L), lambda f: np.exp(-0.5 * (np.log2((f + 1) / (F[1] * scale)) / 1.0) ** 2))
    return y + breath / _rms(breath) * r.uniform(0.02, 0.12) * _env(L, 0.02, 0.04)


def _fric(r, ch: str, dur: float, level: float = 0.5) -> np.ndarray:
    fc, w = FRIC[ch]
    L = max(8, int(dur * SR))
    s = _shape(r.normal(0, 1, L), lambda f: np.exp(-0.5 * (np.log2((f + 1) / fc) / w) ** 2))
    return s / _rms(s) * _env(L, 0.015, 0.03) * level


def _burst(r, fc: float, dur: float, rise: float, level: float = 1.0) -> np.ndarray:
    """Взрывной согласный: смычка размыкается — короткая вспышка шума."""
    L = max(8, int((dur * 5 + rise) * SR))
    t = np.arange(L) / SR
    s = r.normal(0, 1, L) * np.minimum(1, t / rise) * np.exp(-t / dur)
    s = _shape(s, lambda f: np.exp(-0.5 * (np.log2((f + 1) / fc) / 1.2) ** 2))
    return s / (np.abs(s).max() + 1e-9) * level


def _syllable(r, f0: float, scale: float, tilt: float) -> np.ndarray:
    parts = []
    o = r.random()
    if o < 0.35:
        c = str(r.choice(list(PLOS)))
        parts += [np.zeros(int(r.uniform(0.02, 0.06) * SR)), _burst(r, PLOS[c], r.uniform(0.004, 0.012), r.uniform(0.001, 0.004), 0.5)]
    elif o < 0.6:
        parts.append(_fric(r, str(r.choice(list(FRIC))), r.uniform(0.06, 0.14), r.uniform(0.15, 0.5)))
    elif o < 0.75:                                                       # носовой: глухое «м/н»
        parts.append(_vowel(r, f0, r.uniform(0.05, 0.09), (250, 1200, 2300), scale, tilt + 0.8) * 0.4)
    parts.append(_vowel(r, f0 * r.uniform(0.9, 1.12), r.uniform(0.07, 0.2), VOWELS[str(r.choice(list(VOWELS)))], scale, tilt))
    if r.random() < 0.3:
        parts.append(_fric(r, str(r.choice(list(FRIC))), r.uniform(0.04, 0.1), r.uniform(0.1, 0.4)))
    return np.concatenate(parts)


IMITATIONS = ("пф", "пах", "бах", "тыщ", "кх", "пуф", "пиу", "тц")


def mouth_shot(r, kind: str | None = None) -> np.ndarray:
    """Так люди изображают выстрел ртом: смычка губ или языка, громкая вспышка и шипение/гласная.
    Фронт — миллисекунды, а не доли, эха нет, низких частот мало — этим рот и отличается от ружья."""
    kind = kind or str(r.choice(IMITATIONS))
    f0, scale = r.uniform(110, 280), r.uniform(1.0, 1.2)
    lips = {"п": 900, "б": 700, "т": 3800, "к": 2000}
    first = kind[0] if kind[0] in lips else "п"
    out = [np.zeros(int(r.uniform(0.03, 0.12) * SR)), _burst(r, lips[first], r.uniform(0.006, 0.025), r.uniform(0.0006, 0.004), 1.0)]
    if kind == "пф":
        f = _fric(r, "ф", r.uniform(0.08, 0.3), r.uniform(0.4, 0.9))
        out.append(f * np.exp(-np.arange(len(f)) / SR / r.uniform(0.06, 0.2)))     # «ф» гаснет
    elif kind in ("пах", "бах"):
        out += [_vowel(r, f0 * 1.2, r.uniform(0.06, 0.16), VOWELS["а"], scale, 0.7) * r.uniform(0.6, 1.0), _fric(r, "х", r.uniform(0.08, 0.25), r.uniform(0.3, 0.7))]
    elif kind == "тыщ":
        out += [_vowel(r, f0, r.uniform(0.05, 0.1), VOWELS["ы"], scale, 0.8) * 0.7, _fric(r, "щ", r.uniform(0.12, 0.3), r.uniform(0.4, 0.8))]
    elif kind == "кх":
        out.append(_fric(r, "х", r.uniform(0.1, 0.3), r.uniform(0.4, 0.9)))
    elif kind == "пуф":
        out += [_vowel(r, f0, r.uniform(0.04, 0.08), VOWELS["у"], scale, 0.9) * 0.6, _fric(r, "ф", r.uniform(0.1, 0.25), 0.6)]
    elif kind == "пиу":
        out.append(_vowel(r, f0 * 1.3, r.uniform(0.18, 0.35), VOWELS["и"], scale, 0.7, F2=VOWELS["у"]))
    else:                                                                # «тц»: щелчок языком — короткий и резкий
        out = [np.zeros(int(0.05 * SR)), _burst(r, r.uniform(2000, 4500), r.uniform(0.001, 0.003), r.uniform(0.0002, 0.0008), 1.0)]
    return np.concatenate(out)


def human(r: np.random.Generator, n: int = N, imitation: bool | None = None) -> np.ndarray:
    """Люди в воздухе: разговор 1–2 человек (иногда крик или смех) и/или звуки ртом «как выстрел»."""
    dur = n / SR
    out = np.zeros(n)
    imitation = bool(r.random() < 0.35) if imitation is None else imitation
    talk = (not imitation) or r.random() < 0.4
    if talk:
        speakers = [(r.uniform(85, 140) if r.random() < 0.6 else r.uniform(170, 260), r.uniform(0.97, 1.18), r.uniform(0.8, 1.3),
                     r.uniform(0.3, 1.0)) for _ in range(int(r.integers(1, 3)))]
        shout = r.random() < 0.15
        pos = r.uniform(0, min(1.0, dur * 0.3))
        while pos < dur - 0.2:
            f0, scale, tilt, lvl = speakers[int(r.integers(len(speakers)))]
            if shout:
                f0, tilt, lvl = f0 * 1.4, tilt * 0.6, 1.0
            for _ in range(int(r.integers(1, 7))):
                for _ in range(int(r.integers(1, 4))):
                    syl = _syllable(r, f0 * r.uniform(0.92, 1.08), scale, tilt)
                    i = int(pos * SR)
                    m = min(len(syl), n - i)
                    if m <= 0:
                        break
                    out[i:i + m] += syl[:m] * lvl
                    pos += len(syl) / SR
                pos += r.uniform(0.03, 0.2)
            if r.random() < 0.1:                                          # смех: «ха-ха-ха»
                for _ in range(int(r.integers(2, 6))):
                    h = np.concatenate([_fric(r, "х", 0.05, 0.4), _vowel(r, f0 * 1.3, 0.09, VOWELS["а"], scale, tilt)])
                    i = int(pos * SR)
                    m = min(len(h), n - i)
                    if m > 0:
                        out[i:i + m] += h[:m] * lvl
                    pos += len(h) / SR + 0.05
            pos += r.uniform(0.25, 1.2)
    if imitation:
        base = _rms(out) if talk else 0.0
        for _ in range(int(r.integers(1, 4))):
            s = mouth_shot(r) if r.random() < 0.5 else mouth_motor(r)
            i = int(r.uniform(0, max(0.01, dur - len(s) / SR)) * SR)
            m = min(len(s), n - i)
            out[i:i + m] += s[:m] * (max(base * r.uniform(2, 5), 1.0) if talk else 1.0)
    return _distance(out, r.uniform(0.5, 40))


# ---------- комната: проверка микрофоном ноутбука ----------
def indoor(r: np.random.Generator, n: int = N) -> np.ndarray:
    """Тихая комната: шум микрофона, гул электросети (50/60 Гц и кратные — у гула ровный «основной тон»,
    но это не голос и не мотор), вентилятор, клавиатура, дыхание, машины за окном."""
    t = _t(n)
    tilt = r.uniform(0, 1)
    out = _shape(r.normal(0, 1, n), lambda f: (f + 30) ** (-tilt / 2))
    out = out / _rms(out)
    if r.random() < 0.55:                                                # гул сети
        f0 = 50.0 if r.random() < 0.7 else 60.0
        hum = sum(r.uniform(0.05, 1) / k * np.sin(2 * np.pi * f0 * k * t + r.uniform(0, 6.3)) for k in range(1, int(r.integers(3, 20))))
        out += hum / _rms(hum) * 10 ** (r.uniform(-12, 8) / 20)
    if r.random() < 0.45:                                                # вентилятор
        fb = r.uniform(80, 320)
        fan = _shape(r.normal(0, 1, n), lambda f, fc=r.uniform(300, 1500): 1 / (1 + (f / fc) ** 2))
        fan = fan / _rms(fan) + sum(r.uniform(0.1, 0.6) * np.sin(2 * np.pi * fb * k * t) for k in range(1, 4))
        out += fan / _rms(fan) * (1 + 0.1 * np.sin(2 * np.pi * r.uniform(0.1, 1) * t)) * 10 ** (r.uniform(-10, 6) / 20)
    if r.random() < 0.3:                                                 # машины за окном
        car = _shape(r.normal(0, 1, n), lambda f: 1 / (1 + (f / 150) ** 3)) * (0.5 + 0.5 * np.sin(np.pi * t / (n / SR)) ** 2)
        out += car / _rms(car) * 10 ** (r.uniform(-12, 2) / 20)
    if r.random() < 0.35:                                                # клавиатура
        keys = np.zeros(n)
        for i in r.integers(0, n - 200, int(r.uniform(5, 40))):
            L = int(r.uniform(0.002, 0.008) * SR)
            keys[i:i + L] += r.normal(0, 1, L) * np.exp(-np.arange(L) / (L / 3))
        keys = _shape(keys, lambda f, fc=r.uniform(2000, 5000): np.exp(-0.5 * (np.log2((f + 1) / fc) / 1.0) ** 2))
        out += keys / (np.abs(keys).max() + 1e-9) * r.uniform(1, 6)
    if r.random() < 0.2:                                                 # дыхание
        br = _shape(r.normal(0, 1, n), lambda f: np.exp(-0.5 * (np.log2((f + 1) / 1100) / 1.0) ** 2))
        out += br / _rms(br) * np.clip(np.sin(2 * np.pi * r.uniform(0.2, 0.35) * t), 0, None) ** 2 * 10 ** (r.uniform(-8, 4) / 20)
    return room(out, r) if r.random() < 0.6 else out


HANDMADE = ("clap", "snap", "knock", "steps")


def handmade(r: np.random.Generator, n: int = N, kind: str | None = None) -> np.ndarray:
    """Руками и ногами: хлопки в ладоши, щелчки пальцами, стук по столу, шаги — резко, но не выстрел:
    у хлопка нет мощного низа дульной волны и долгого эха."""
    kind = kind or str(r.choice(HANDMADE))
    out = np.zeros(n)
    dur = n / SR
    pos = r.uniform(0.1, max(0.2, dur * 0.4))
    for _ in range(int(r.integers(1, 7)) if kind != "steps" else int(dur * 1.8)):
        i = int(pos * SR)
        L = int(0.12 * SR)
        if i + L >= n:
            break
        tt = np.arange(L) / SR
        if kind == "clap":
            s = r.normal(0, 1, L) * np.minimum(1, tt / r.uniform(0.0004, 0.0015)) * np.exp(-tt / r.uniform(0.004, 0.015))
            s = _shape(s, lambda f, fc=r.uniform(900, 2800): np.exp(-0.5 * (np.log2((f + 1) / fc) / 1.1) ** 2))
            step = r.uniform(0.25, 0.7)
        elif kind == "snap":
            s = r.normal(0, 1, L) * np.minimum(1, tt / 0.0003) * np.exp(-tt / r.uniform(0.001, 0.004))
            s = _shape(s, lambda f, fc=r.uniform(2000, 5000): np.exp(-0.5 * (np.log2((f + 1) / fc) / 0.8) ** 2))
            step = r.uniform(0.3, 0.9)
        elif kind == "knock":
            s = np.sin(2 * np.pi * r.uniform(150, 600) * tt) * np.exp(-tt / r.uniform(0.01, 0.05)) * np.minimum(1, tt / 0.001)
            s += r.normal(0, 1, L) * np.exp(-tt / 0.002) * 0.3
            step = r.uniform(0.12, 0.35)
        else:
            s = _shape(r.normal(0, 1, L), lambda f: 1 / (1 + (f / 300) ** 2)) * np.exp(-tt / 0.03) * np.minimum(1, tt / 0.004)
            step = r.uniform(0.45, 0.7)
        out[i:i + L] += s / (np.abs(s).max() + 1e-9) * r.uniform(0.6, 1.0)
        pos += step
    return out


MOUTH_MOTOR = ("бррр", "ррр", "вжжж", "ммм", "тр-тр", "бр-бр")


def mouth_motor(r: np.random.Generator, kind: str | None = None) -> np.ndarray:
    """Человек изображает мотор: губная или язычковая трель («бррр», «ррр»), «вжжж», гудение «ммм»,
    короткие «бр-бр-бр», «тр-тр-тр». Пульсация 20–35 Гц похожа на вспышки мотора, но под ней голос:
    тон 90–260 Гц гуляет, есть форманты гласной, а сам звук обрывается, когда кончается дыхание."""
    kind = kind or str(r.choice(MOUTH_MOTOR))
    f0, scale, tilt = r.uniform(90, 260), r.uniform(0.97, 1.18), r.uniform(0.7, 1.2)
    vowel = VOWELS[str(r.choice(["у", "ы", "а", "о", "э"]))]
    parts = []
    reps = int(r.integers(2, 6)) if kind in ("тр-тр", "бр-бр") else 1
    for _ in range(reps):
        d = r.uniform(0.12, 0.45) if reps > 1 else r.uniform(0.6, 3.0)
        L = int(d * SR)
        t = np.arange(L) / SR
        v = _vowel(r, f0 * r.uniform(0.9, 1.15), d, vowel if kind != "ммм" else (250, 1200, 2300), scale, tilt + (0.8 if kind == "ммм" else 0))
        if kind in ("бррр", "ррр", "тр-тр", "бр-бр"):
            fm = r.uniform(20, 35) * (1 + r.uniform(-0.15, 0.15) * t / d)
            am = (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(fm) / SR)) ** r.uniform(1.5, 3.5)
            v = v * (0.15 + am)
            flutter = _shape(r.normal(0, 1, L), lambda f, fc=r.uniform(800, 2500): np.exp(-0.5 * (np.log2((f + 1) / fc) / 1.2) ** 2))
            v = v + flutter / _rms(flutter) * am * r.uniform(0.1, 0.5)
        elif kind == "вжжж":
            z = _shape(r.normal(0, 1, L), lambda f: np.exp(-0.5 * (np.log2((f + 1) / 3000) / 0.5) ** 2))
            v = v * 0.6 + z / _rms(z) * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(np.full(L, f0)) / SR)) * r.uniform(0.3, 0.8)
        v = v * _env(L, r.uniform(0.01, 0.08), r.uniform(0.03, 0.2))
        if kind in ("бррр", "бр-бр", "тр-тр"):                          # смычка губ или языка в начале
            b = _burst(r, 900 if kind != "тр-тр" else 3800, r.uniform(0.004, 0.012), r.uniform(0.0008, 0.004), r.uniform(0.6, 1.4))
            v = np.concatenate([b * np.abs(v).max(), v])
        parts += [v, np.zeros(int(r.uniform(0.04, 0.25) * SR))]
    return np.concatenate(parts)



def room(x: np.ndarray, r: np.random.Generator) -> np.ndarray:
    """Комнатное эхо — когда звук записан микрофоном ноутбука или телефона в помещении."""
    L = int(r.uniform(0.15, 0.6) * SR)
    h = r.normal(0, 1, L) * np.exp(-6.9 * np.arange(L) / L) * 10 ** (r.uniform(-20, -10) / 20)
    h[0] = 1.0
    return _conv(x, h)


WATER_DISTRACTORS = ("thunder", "wave", "fish", "oar", "airplane")


def distractor_in(r: np.random.Generator, n: int, medium: str, kind: str | None = None) -> np.ndarray:
    """Помеха в своей среде: под водой — гром через поверхность, волна о буй, всплеск и весло в воде, самолёт."""
    if medium == "air":
        return distractor(r, n, kind)
    kind = kind or str(r.choice(WATER_DISTRACTORS))
    if kind == "thunder":
        return to_water(thunder(r, n), r, loss_db=0, fc=r.uniform(150, 400))
    if kind == "wave":
        return wave_slap(r, n)
    if kind == "airplane":
        return to_water(distractor(r, n, "airplane"), r, loss_db=0, fc=r.uniform(200, 500))
    return multipath(distractor(r, n, kind), r)                          # всплеск и весло — уже в воде

# ---------- сцена ----------
def scene(r: np.random.Generator, event: str, v: Vessel | None = None, activity: float | None = None,
          snr_db: float | None = None, n: int = N, segment: tuple[float, float, float] | None = None,
          medium: str = "water", voices: bool = False, imitation: bool | None = None,
          gain: float | None = None) -> tuple[np.ndarray, dict]:
    """Клип буя: фон + природа (+ событие с заданным отношением сигнал/шум). Возвращает звук и разметку.
    medium — где микрофон: water (гидрофон буя) или air (проверка микрофоном).
    segment — (начало, длина в долях клипа, плавность в секундах): мотор слышно не весь клип,
    а появляется или затихает внутри него (катер завёлся, заглушил мотор, ушёл за мыс).
    voices — у мотора в лодке ещё и разговаривают (метка остаётся «мотор»).
    gain — постоянное усиление, как у настоящего гидрофона: фон всегда на этом уровне (СКЗ), а событие громче
    на свои дБ — тогда по громкости клипов у соседних буёв видно, к какому источник ближе. Без gain громкость
    клипа случайна (так учится сеть: ей не важно, насколько громко записано)."""
    water = medium == "water"
    act = float(r.uniform(0, 1)) if activity is None else activity
    inside = (not water) and r.random() < 0.45                         # в воздухе почти половина — комната
    if inside:
        act = 0.0 if activity is None else act
    bg = hydro_ambient(r, n) if water else (indoor(r, n) if inside else ambient(r, n))
    bio = nature_water(r, act, n) if water else nature(r, act, n)
    if act > 0.02:                                     # чем живее природа, тем больше голосов и тем они громче
        bg = bg + bio / (_rms(bio) + 1e-9) * _rms(bg) * 10 ** ((-16 + 22 * act + r.uniform(-2.5, 2.5)) / 20)
    meta = {"event": event, "activity": act, "vessel": v.seed if v else None, "medium": medium, "indoor": inside}
    if event == "background" and r.random() < 0.4:
        d = handmade(r, n) if (not water and r.random() < 0.5) else distractor_in(r, n, medium)
        bg = bg + d / (_rms(d) + 1e-9) * _rms(bg) * 10 ** (r.uniform(-4, 12) / 20)
    x = bg
    if event in ("motor", "shot", "voice"):
        if event == "motor":
            s = motor(v or vessel(int(r.integers(1 << 30))), r, n, water=water)
            s = multipath(s, r) if water else s
        elif event == "shot":
            s = shot_water(r, n) if water else shot(r, n)
        else:
            s = human(r, n, imitation)
            s = to_water(s, r, loss_db=0) if water else s
            meta["imitation"] = imitation
        snr = (r.uniform(0, 24) if event == "voice" else r.uniform(-3, 20)) if snr_db is None else snr_db
        ref = _rms(s)
        if segment and event == "motor":
            a, L = int(segment[0] * n), max(SR // 2, int(segment[1] * n))
            f = max(1, min(L // 2, int(segment[2] * SR)))
            mask = np.zeros(n)
            mask[a:a + L] = 1
            ramp = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
            mask[a:a + f] = ramp[: len(mask[a:a + f])]
            end = min(n, a + L)
            mask[max(a, end - f):end] = ramp[::-1][-(end - max(a, end - f)):] if end - max(a, end - f) > 0 else []
            s = s * mask
            ref = _rms(s[a:end])                          # отношение сигнал/шум — пока мотор слышно
            meta["segment"] = segment
        x = bg + s / ref * _rms(bg) * 10 ** (snr / 20)
        meta["snr_db"] = snr
        if voices and event == "motor":                  # в лодке разговаривают
            h = human(r, n, imitation=False)
            h = to_water(h, r, loss_db=0) if water else h
            x = x + h / _rms(h) * _rms(bg) * 10 ** (r.uniform(-6, 6) / 20)
    if not water and r.random() < 0.3:
        x = room(x, r)
    if gain is not None:
        x = np.clip(x / (_rms(bg) + 1e-12) * gain, -1, 1)
        return x.astype(np.float32), meta
    x = x / (np.abs(x).max() + 1e-9) * r.uniform(0.1, 0.9)
    return x.astype(np.float32), meta
