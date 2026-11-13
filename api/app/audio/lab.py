"""Лаборатория нейросети: подробный разбор звука для страницы «Нейросеть» на сайте.

Ничего не меняет в системе: тревог не поднимает, архив катеров не трогает. Показывает всё,
что делает конвейер буя, по шагам:
  • волна и лог-мел спектрограмма (то, что «видит» сеть);
  • ход вероятностей по времени (скользящее окно 4 с, шаг 0,5 с);
  • решения уха буя клип за клипом (по 4 с, как присылает буй): порог, «два клипа подряд»,
    обычная живость природы и тишина как улика;
  • мотор: основная частота, гармоники, отпечаток катера и сверка с архивом;
  • импульс: пик к среднему, фронт, центр спектра — выстрел или помеха;
  • природа: живость по времени, энергия в полосе 1,2–7,6 кГц;
  • все признаки клипа с пояснениями.
Сценарии синтеза — чтобы проверить сеть на мотор, выстрел, тишину и коварные помехи.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

from . import dsp, synth
from .listener import Ear, hear
from .model import Acoustic, Analysis

WIN = synth.N                     # окно сети — 4 с, как клип буя
STEP = dsp.SR // 2                # шаг хода вероятностей — 0,5 с

FEATURES = [
    ("onset", "Резкость нарастания", "дБ", "самые резкие скачки громкости между кадрами: выстрел — десятки дБ"),
    ("crest", "Пик над обычным", "дБ", "насколько самый громкий кадр выше медианного"),
    ("decay", "Резкость спада", "дБ", "как быстро звук гаснет после пика"),
    ("harm", "Гармоничность", "", "сила ровного гармонического ряда по кепстру: у мотора — высокая"),
    ("log_f0", "Основная частота", "Гц", "период гармонического ряда (обороты или вспышки мотора)"),
    ("low", "Доля низких частот", "lg", "энергия 30–600 Гц от всей: мотор и гром — низкие"),
    ("flat", "Шумность спектра", "", "ровный шум ближе к 1, тон — к 0"),
    ("aci", "Сложность звука (ACI)", "", "изменчивость в полосе природы: хоры лягушек, птицы, водные насекомые"),
    ("bio_act", "Голоса природы", "дБ", "насколько полоса 1,2–7,6 кГц выше своего шумового пола"),
    ("mod", "Пульсация огибающей", "lg", "периодичность громкости низких полос (2–25 Гц)"),
    ("imp_crest", "Пик к среднему", "дБ", "по отсчётам: у выстрела — 30+ дБ"),
    ("imp_rise", "Фронт удара", "мс", "время нарастания самого резкого звука: у выстрела — доли миллисекунды, у «пф» ртом — миллисекунды"),
    ("imp_centroid", "Центр спектра удара", "кГц", "у выстрела спектр широкий, у удара весла — низкий"),
    ("imp_width", "Длительность вспышки", "мс", "сколько удар держится выше 30 % пика: шипение «пф» тянется дольше дульной волны"),
    ("imp_low", "Низы в ударе", "", "доля энергии ниже 400 Гц вокруг удара: у ружья мощный низ, у рта его почти нет"),
    ("voiced", "Звонкость", "", "доля кадров с основным тоном голоса 75–400 Гц: речь, крик, «бах»"),
    ("f0_drift", "Плавание тона", "пт", "разброс основного тона в полутонах: речь — гуляет, мотор — ровный"),
    ("syllables", "Ритм слогов", "", "доля модуляции 3–8 Гц в полосе речи 300–3000 Гц: так звучит речь"),
]

PRESETS = {
    "motor-archive": "Мотор катера из архива",
    "motor-new": "Мотор нового катера",
    "shot": "Выстрел",
    "night": "Тихая ночь",
    "silence": "Тишина как улика",
    "voices": "Голоса людей: разговор в лодке",
    "imitation": "Выстрел голосом: «пф», «бах», «тыщ»",
    "mouth-motor": "Мотор голосом: «бррр», «вжжж», «тр-тр-тр»",
    "room": "Тишина в комнате: микрофон, гул, вентилятор",
    "claps": "Хлопки в ладоши, щелчки, стук по столу",
    "thunder": "Помеха: гром",
    "wave": "Помеха: волна бьёт о буй",
    "airplane": "Помеха: самолёт вдали",
    "oar": "Помеха: удар весла о борт",
    "fish": "Помеха: всплеск рыбы",
    "rain": "Помеха: дождь",
}
MEDIUM_RU = {"water": "гидрофон под водой", "air": "микрофон в воздухе"}


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def _fade(n: int, f: int) -> np.ndarray:
    e = np.ones(n)
    f = min(f, n // 2)
    if f > 0:
        ramp = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
        e[:f], e[-f:] = ramp, ramp[::-1]
    return e


@dataclass
class Scene:
    x: np.ndarray
    title: str
    truth: str               # что на самом деле в звуке — чтобы сравнить с ответом сети
    marks: list[dict]        # где что лежит: [{start, end, label}]


def scene(preset: str, *, vessel_seed: int | None = None, duration: float = 12.0, snr_db: float = 10.0,
          activity: float = 0.7, seed: int = 1, medium: str = "water") -> Scene:
    """Сцена лаборатории: фон дельты нужной длины в своей среде (под водой или в воздухе) + событие в своём отрезке."""
    r = np.random.default_rng(seed)
    sr = dsp.SR
    water = medium == "water"
    n = int(sr * min(30.0, max(4.0, duration)))
    dur = n / sr
    inside = (not water) and preset in ("voices", "imitation", "mouth-motor", "room", "claps")   # проверка микрофоном — в комнате
    bg = synth.hydro_ambient(r, n, rain=preset == "rain") if water else (synth.indoor(r, n) if inside else synth.ambient(r, n, rain=preset == "rain"))
    nat = synth.nature_water if water else synth.nature
    act = 0.0 if preset == "silence" or inside else activity
    marks: list[dict] = []
    if preset == "silence":                                    # природа живёт, потом стихает
        cut = int(n * 0.42)
        b1 = nat(r, max(activity, 0.6), n)
        k = np.ones(n)
        k[cut:] = 0
        k[cut:cut + sr] = np.cos(np.linspace(0, np.pi / 2, min(sr, n - cut))) ** 2
        bio = b1 * k + nat(r, 0.03, n) * (1 - k)
        level = 10 ** ((-16 + 22 * max(activity, 0.6)) / 20)
        bg = bg + bio / (_rms(b1) + 1e-9) * _rms(bg) * level
        marks.append({"start": round(cut / sr, 2), "end": round(dur, 2), "label": "природа стихла"})
        truth = "тишина"
    else:
        if act > 0.02:
            bio = nat(r, act, n)
            bg = bg + bio / (_rms(bio) + 1e-9) * _rms(bg) * 10 ** ((-16 + 22 * act) / 20)
        truth = "фон"
    x = bg.copy()

    def put(s: np.ndarray, a: int, ref: float, label: str, end: int | None = None):
        m = min(len(s), n - a)
        x[a:a + m] += s[:m] / ref * _rms(bg) * 10 ** (snr_db / 20)
        marks.append({"start": round(a / sr, 2), "end": round((end if end is not None else a + m) / sr, 2), "label": label})

    if preset in ("motor-archive", "motor-new"):
        v = synth.vessel(vessel_seed if vessel_seed is not None else int(r.integers(10_000, 1 << 30)))
        a, b = int(n * 0.12), int(n * 0.92)
        m = synth.motor(v, r, b - a, water=water)
        m = (synth.multipath(m, r) if water else m) * _fade(b - a, sr)
        put(m, a, _rms(m[sr:-sr] if b - a > 3 * sr else m), "мотор")
        truth = "мотор"
    elif preset == "shot":
        a = int(n * 0.5)
        s = synth.shot_water(r, WIN) if water else synth.shot(r, WIN)
        put(s, a, _rms(s), "выстрел", a + sr)                       # как при обучении: мощность на 4 с
        truth = "выстрел"
    elif preset in ("voices", "imitation"):
        a, b = int(n * 0.1), int(n * 0.95)
        h = synth.human(r, b - a, imitation=preset == "imitation")
        h = synth.to_water(h, r, loss_db=0) if water else h
        put(h, a, _rms(h), "голоса" if preset == "voices" else "звуки ртом", b)
        truth = "голоса"
    elif preset == "mouth-motor":
        a = int(n * 0.1)
        h = np.concatenate([synth.mouth_motor(r) for _ in range(12)])[: n - a]
        h = synth.to_water(h, r, loss_db=0) if water else h
        put(h, a, _rms(h[h != 0]) if np.any(h) else 1.0, "«мотор» голосом")
        truth = "голоса"
    elif preset == "claps":
        a = int(n * 0.2)
        h = synth.handmade(r, n - a)
        h = synth.multipath(h, r) if water else h
        put(h, a, _rms(h), "хлопки и стук")
        truth = "фон (помеха)"
    elif preset == "room":
        truth = "фон"
    elif preset in ("thunder", "wave", "airplane", "oar", "fish"):
        a = int(n * 0.35)
        L = min(int(sr * 4), n - a)
        kind = preset
        if not water and preset == "wave":
            kind = "fish"
        d = synth.distractor_in(r, L, medium, kind) if water or preset != "thunder" else synth.thunder(r, L)
        put(d, a, _rms(d), PRESETS[preset].split(": ")[-1])
        truth = "фон (помеха)"
    elif preset == "rain":
        truth = "фон (помеха)"
    x = x / (np.abs(x).max() + 1e-9) * 0.8
    return Scene(x.astype(np.float32), PRESETS.get(preset, preset), truth, marks)


# ---------- разбор ----------
def _b64(a: np.ndarray) -> str:
    return base64.b64encode(a.astype(np.uint8).tobytes()).decode("ascii")


def _windows(n: int, size: int, step: int) -> list[int]:
    if n <= size:
        return [0]
    starts = list(range(0, n - size + 1, step))
    if starts[-1] + size < n:
        starts.append(n - size)
    return starts


def _round(v, k=3):
    return [round(float(t), k) for t in v]


def analyze(m: Acoustic, x: np.ndarray, thresholds: dict[str, float], vessels: dict[str, dict], match_threshold: float, cut=None) -> dict:
    sr = dsp.SR
    x = np.asarray(x, np.float32)
    x = x - x.mean()
    n = len(x)
    dur = n / sr
    peak = float(np.abs(x).max())
    xn = x / (peak + 1e-9)

    # волна: минимум и максимум в 1200 столбцах
    B = 1200
    edges = np.linspace(0, n, B + 1).astype(int)
    wmin = [float(xn[a:b].min()) if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])]
    wmax = [float(xn[a:b].max()) if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])]

    # спектрограмма: то, что «видит» сеть
    L = dsp.logmel(xn)
    lo, hi = float(np.percentile(L, 3)), float(np.percentile(L, 99.7))
    spec = np.clip((L - lo) / max(1e-6, hi - lo), 0, 1) * 255

    # ход вероятностей: окно 4 с, шаг 0,5 с
    starts = _windows(n, WIN, STEP)
    feats = np.array([dsp.event_features(x[s:s + WIN]) for s in starts])
    P = m.events.forward(feats)
    A = np.clip(m.bio.forward(feats)[:, 0], 0, 1)
    NOV = m.novelty(feats)
    classes = m.classes
    timeline = [{"t": round((s + min(WIN, n) / 2) / sr, 2), "start": round(s / sr, 2),
                 **{c: round(float(p), 4) for c, p in zip(classes, P[i])}, "activity": round(float(A[i]), 3),
                 "novelty": round(float(NOV[i]), 2)}
                for i, s in enumerate(starts)]

    # клипы буя: подряд по 4 с — как их присылает буй, и что решило бы ухо
    ear = Ear()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    clips = []
    cs = list(range(0, n, WIN)) if n > WIN else [0]
    for i, s in enumerate(cs):
        seg = x[s:s + WIN]
        if len(seg) < sr * 2 and i > 0:
            break
        f = dsp.event_features(seg)
        p = m.events.forward(f)[0]
        k = int(np.argmax(p))
        act = float(np.clip(m.bio.forward(f)[0, 0], 0, 1))
        nov = float(m.novelty(f)[0])
        an = Analysis(event=classes[k], confidence=round(float(p[k]), 3), probs={c: round(float(v), 4) for c, v in zip(classes, p)},
                      activity=round(act, 3), novelty=round(nov, 2), unfamiliar=nov > 1)
        base_before = ear.baseline
        kind, conf, note = hear(ear, an, thresholds, t0 + timedelta(seconds=4 * i))
        clips.append({"i": i + 1, "start": round(s / sr, 2), "end": round(min(n, s + WIN) / sr, 2), "event": an.event,
                      "confidence": an.confidence, "probs": an.probs, "activity": an.activity, "alert": kind,
                      "alert_confidence": round(conf, 3) if kind else None, "note": note, "novelty": round(nov, 2),
                      "baseline": round(base_before, 3) if base_before is not None else None, "quiet": ear.quiet})

    # главный клип: где сработала тревога, иначе где сильнее угроза, иначе первый
    pick = next((c for c in clips if c["alert"]), None) or max(clips, key=lambda c: 1 - c["probs"]["background"])
    main_seg = x[int(pick["start"] * sr):int(pick["start"] * sr) + WIN]
    mf = dsp.event_features(main_seg)
    named = dict(zip([k for k, *_ in FEATURES], mf[-len(FEATURES):].tolist()))
    named["log_f0"] = float(np.exp(named["log_f0"]))
    named["imp_rise"] = float(10 ** named["imp_rise"] * 1000)
    named["imp_width"] = float(10 ** named["imp_width"] * 1000)
    features = [{"key": k, "label": lab, "unit": u, "hint": h, "value": round(named[k], 3)} for k, lab, u, h in FEATURES]

    # мотор: окно с самой высокой вероятностью мотора
    mi = int(np.argmax(P[:, 1]))
    motor = None
    if P[mi, 1] > 0.5:
        seg = x[starts[mi]:starts[mi] + WIN]
        v = dsp.vessel_features(seg)
        f0 = float(np.exp(v[-1]))
        psd = dsp.welch_db(seg / (np.abs(seg).max() + 1e-9))
        fr = np.fft.rfftfreq(dsp.WELCH, 1 / sr)
        keep = fr <= 1600
        _, strength = dsp.f0_cepstrum(psd, 15, 420)
        harm = []
        for k in range(1, 25):
            fk = k * f0
            if fk > 1600:
                break
            j = int(round(fk / fr[1]))
            harm.append({"k": k, "hz": round(fk, 1), "db": round(float(psd[max(0, j - 2):j + 3].max()), 1)})
        fp = m.vessel.embed(v)[0]
        sims = sorted(((float(np.dot(fp, np.asarray(vv["vector"]) / (np.linalg.norm(vv["vector"]) + 1e-9))), vid, vv)
                       for vid, vv in vessels.items()), key=lambda t: -t[0])
        cut = cut or (lambda vv: match_threshold)
        sims = sorted(((s_, vid, vv, float(cut(vv))) for s_, vid, vv in sims), key=lambda t: -(t[0] - t[3]))
        best = sims[0] if sims else None
        motor = {
            "window_start": round(starts[mi] / sr, 2), "probability": round(float(P[mi, 1]), 4),
            "f0_hz": round(f0, 1), "rpm_if_crank": round(f0 * 60), "harmonicity": round(float(strength), 2),
            "psd": {"hz_step": round(float(fr[1]), 4), "db": _round(psd[keep], 1)}, "harmonics": harm,
            "fingerprint": _round(fp, 4),
            "matches": [{"vessel_id": vid, "similarity": round(s_, 4), "threshold": round(c_, 4), "last_seen": str(vv.get("last_seen") or ""),
                         "seen": int(vv.get("seen", 0))} for s_, vid, vv, c_ in sims[:6]],
            "match_threshold": round(match_threshold, 4),
            "verdict": (f"узнан: {best[1]}" if best and best[0] >= best[3] else "новый катер — в архиве нет похожего"),
        }

    # импульс: самый резкий звук всей записи
    a = np.abs(xn)
    env = np.convolve(a, np.ones(16) / 16, mode="same")
    pi = int(np.argmax(env))
    crest, lrise, cen, lwidth, lowf = dsp.impulse(xn[max(0, pi - WIN // 2):max(0, pi - WIN // 2) + WIN])
    z0, z1 = max(0, pi - int(0.04 * sr)), min(n, pi + int(0.06 * sr))
    zoom = xn[z0:z1]
    zi = np.linspace(0, len(zoom) - 1, min(500, len(zoom))).astype(int)
    si = int(np.argmax(P[:, 2]))
    impulse = {"t": round(pi / sr, 3), "crest_db": round(crest, 1), "rise_ms": round(10 ** lrise * 1000, 2), "centroid_khz": round(cen, 2),
               "width_ms": round(10 ** lwidth * 1000, 1), "low_share": round(lowf, 3),
               "shot_probability": round(float(P[si, 2]), 4), "shot_window_start": round(starts[si] / sr, 2),
               "zoom": {"t0": round(z0 / sr, 4), "t1": round(z1 / sr, 4), "y": _round(zoom[zi], 3)}}

    # природа: энергия полосы 1,2–7,6 кГц над её шумовым полом по кадрам
    bio = (dsp.mel_centers() >= dsp.BIO_LO) & (dsp.mel_centers() <= dsp.BIO_HI)
    R = L[:, bio] - np.percentile(L[:, bio], 20, axis=0)
    curve = np.clip(R, 0, 30).mean(1)
    k = max(1, len(curve) // 600)
    curve = curve[: len(curve) // k * k].reshape(-1, k).mean(1) if k > 1 else curve
    nature = {"activity": round(float(np.mean(A)), 3), "bio_curve": _round(curve, 2), "frame_s": round(dsp.HOP / sr * k, 4),
              "band_hz": [dsp.BIO_LO, dsp.BIO_HI]}

    alerts = [c for c in clips if c["alert"]]
    return {
        "duration_s": round(dur, 3), "sr": sr, "level_db": round(dsp.rms_db(x), 1), "peak": round(peak, 3),
        "classes": classes, "thresholds": {k2: round(v2, 4) for k2, v2 in thresholds.items()},
        "wave": {"min": _round(wmin, 3), "max": _round(wmax, 3)},
        "spec": {"frames": int(L.shape[0]), "bands": int(L.shape[1]), "hop_s": dsp.HOP / sr, "win_s": dsp.N_FFT / sr,
                 "db_lo": round(lo, 1), "db_hi": round(hi, 1), "data": _b64(spec), "mel_hz": _round(dsp.mel_centers(), 1)},
        "timeline": timeline, "clips": clips, "main_clip": pick["i"], "features": features,
        "motor": motor, "impulse": impulse, "nature": nature,
        "verdict": {"alerts": [{"kind": c["alert"], "clip": c["i"], "confidence": c["alert_confidence"]} for c in alerts],
                    "event": pick["event"], "confidence": pick["confidence"], "novelty": pick["novelty"],
                    "unfamiliar": any(c["novelty"] > 1 for c in clips)},
    }
