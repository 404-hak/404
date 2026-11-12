"""Звук буя → числа: чтение WAV, спектр, признаки клипа.

Формат клипа: моно 16 кГц, 2–30 с (другие частоты и стерео приводятся к нему).
Признаки двух видов:
  event_features  — для нейросети событий (фон / мотор / выстрел) и оценки живости природы:
                    спектр относительно шумового пола, импульсность, гармоничность, полосы природы;
  vessel_features — для отпечатка катера: огибающая спектра (резонансы корпуса и выхлопа),
                    профиль гармоник мотора; не зависят от громкости и дистанции в первом приближении.
"""
from __future__ import annotations

import io
import wave
from functools import lru_cache

import numpy as np

SR = 16000
N_FFT = 1024
HOP = 256
N_MELS = 64
F_MIN, F_MAX = 40.0, 7600.0
WELCH = 4096                     # длинное окно для гармоник мотора (разрешение ~3,9 Гц)
MIN_S, MAX_S = 1.0, 30.0


class AudioError(ValueError):
    """Клип не прочитать или он не подходит (формат, длина, тишина в ноль)."""


# ---------- чтение и запись ----------
def read_wav(data: bytes) -> np.ndarray:
    """WAV (PCM 8/16/24/32 бит, любые каналы и частота) → моно float32 16 кГц, −1…1."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
    except (wave.Error, EOFError) as e:
        raise AudioError(f"не WAV PCM: {e}") from e
    if width == 1:
        x = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128) / 128
    elif width == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768
    elif width == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        x = (np.where(v >= 1 << 23, v - (1 << 24), v)).astype(np.float32) / (1 << 23)
    elif width == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / (1 << 31)
    else:
        raise AudioError(f"неподдерживаемая разрядность: {width * 8} бит")
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != SR:
        x = resample(x, rate, SR)
    dur = len(x) / SR
    if not MIN_S <= dur <= MAX_S:
        raise AudioError(f"длина клипа {dur:.1f} с, нужно {MIN_S:.0f}–{MAX_S:.0f} с")
    return x.astype(np.float32)


def write_wav(x: np.ndarray, sr: int = SR) -> bytes:
    """float −1…1 → WAV PCM 16 бит моно."""
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """Передискретизация через спектр (без лишних зависимостей); при понижении частоты срезает лишнее."""
    n_out = int(round(len(x) * sr_out / sr_in))
    X = np.fft.rfft(x)
    keep = min(len(X), n_out // 2 + 1)
    Y = np.zeros(n_out // 2 + 1, dtype=complex)
    Y[:keep] = X[:keep]
    return (np.fft.irfft(Y, n_out) * (n_out / len(x))).astype(np.float32)


# ---------- спектр ----------
@lru_cache(maxsize=1)
def mel_bank() -> np.ndarray:
    """Треугольные мел-фильтры N_MELS × (N_FFT/2+1)."""
    def hz2mel(f):
        return 2595 * np.log10(1 + f / 700)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595) - 1)

    mels = np.linspace(hz2mel(F_MIN), hz2mel(F_MAX), N_MELS + 2)
    hz = mel2hz(mels)
    bins = np.fft.rfftfreq(N_FFT, 1 / SR)
    fb = np.zeros((N_MELS, len(bins)), np.float32)
    for i in range(N_MELS):
        lo, c, hi = hz[i], hz[i + 1], hz[i + 2]
        fb[i] = np.clip(np.minimum((bins - lo) / (c - lo), (hi - bins) / (hi - c)), 0, None)
    return fb / np.maximum(fb.sum(axis=1, keepdims=True), 1e-9)


@lru_cache(maxsize=1)
def mel_centers() -> np.ndarray:
    return mel_bank() @ np.fft.rfftfreq(N_FFT, 1 / SR)


def frames(x: np.ndarray, n: int, hop: int) -> np.ndarray:
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    k = 1 + (len(x) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(k)[:, None]
    return x[idx]


def logmel(x: np.ndarray) -> np.ndarray:
    """Лог-мел спектрограмма, дБ: кадры × N_MELS (кадр 64 мс, шаг 16 мс)."""
    f = frames(x, N_FFT, HOP) * np.hanning(N_FFT).astype(np.float32)
    p = np.abs(np.fft.rfft(f, axis=1)) ** 2
    return 10 * np.log10(p @ mel_bank().T + 1e-10)


def welch_db(x: np.ndarray) -> np.ndarray:
    """Средний спектр мощности длинным окном, дБ (WELCH/2+1 полос по ~3,9 Гц)."""
    f = frames(x, WELCH, WELCH // 2) * np.hanning(WELCH)
    p = (np.abs(np.fft.rfft(f, axis=1)) ** 2).mean(axis=0)
    return 10 * np.log10(p + 1e-12)


def f0_cepstrum(psd_db: np.ndarray, lo: float = 25.0, hi: float = 260.0) -> tuple[float, float]:
    """Основная частота гармонического ряда (мотор) по кепстру: (частота, сила пика)."""
    c = np.fft.irfft(psd_db - psd_db.mean())
    q0, q1 = int(SR / hi), int(SR / lo)
    seg = c[q0:q1]
    i = int(np.argmax(seg))
    strength = float(seg[i] / (np.std(c[q0:q1 * 2]) + 1e-9))
    return SR / (q0 + i), strength


# ---------- признаки ----------
BIO_LO, BIO_HI = 1200.0, 7600.0      # полоса природы: лягушки, птицы, насекомые


def _common(x: np.ndarray):
    x = x - x.mean()
    if float(np.abs(x).max()) < 1e-5:
        raise AudioError("клип пустой: только тишина в ноль")
    return x / (np.abs(x).max() + 1e-9)


def event_features(x: np.ndarray) -> np.ndarray:
    """Вектор признаков клипа для нейросети событий и оценки природы (не зависит от громкости записи)."""
    x = _common(x)
    L = logmel(x)                                       # T × 64
    floor = np.percentile(L, 20, axis=0)                # шумовой пол по полосам
    R = L - floor
    mean, std, peak = R.mean(0), R.std(0), np.percentile(R, 98, axis=0)
    # общий уровень по полосам относительно самого тихого — форма спектра
    shape = floor - floor.mean()
    E = 10 * np.log10((10 ** (L / 10)).sum(1) + 1e-10)  # энергия кадра, дБ
    dE = np.diff(E)
    onset = np.sort(dE)[-3:].mean() if len(dE) > 3 else 0.0       # самые резкие нарастания — выстрел
    crest = float(E.max() - np.median(E))
    decay = float(-np.sort(dE)[:3].mean()) if len(dE) > 3 else 0.0
    # гармоничность: мотор — ровный гармонический ряд
    psd = welch_db(x)
    f0, harm = f0_cepstrum(psd)
    fr = np.fft.rfftfreq(WELCH, 1 / SR)
    low = float(np.log10((10 ** (psd[(fr > 30) & (fr < 600)] / 10)).sum() / (10 ** (psd[fr > 30] / 10)).sum() + 1e-9))
    flat = float(np.mean(np.exp(np.mean(np.log(10 ** (L / 10) + 1e-12), 1)) / (np.mean(10 ** (L / 10), 1) + 1e-12)))
    # природа: активность в полосе 1,2–7,6 кГц и «сложность» (ACI — изменчивость по времени)
    bio = (mel_centers() >= BIO_LO) & (mel_centers() <= BIO_HI)
    P = 10 ** (L[:, bio] / 10)
    aci = float(np.mean(np.abs(np.diff(P, axis=0)).sum(0) / (P.sum(0) + 1e-12)))
    bio_act = float(np.mean(np.clip(R[:, bio], 0, 30)))
    # модуляция огибающей низких полос (пульсация мотора, всплески)
    env = (10 ** (L[:, :20] / 10)).sum(1)
    env = (env - env.mean()) / (env.std() + 1e-9)
    ms = np.abs(np.fft.rfft(env)) ** 2
    mfr = np.fft.rfftfreq(len(env), HOP / SR)
    mod = float(np.log10(ms[(mfr > 2) & (mfr < 25)].max() / (ms[(mfr > 0.3) & (mfr < 25)].mean() + 1e-9) + 1e-9))
    scal = np.array([onset, crest, decay, harm, np.log(f0), low, flat, aci, bio_act, mod, *impulse(x)], np.float32)
    return np.concatenate([mean, std, peak, shape, scal]).astype(np.float32)


def impulse(x: np.ndarray) -> tuple[float, float, float]:
    """Самый резкий звук клипа по отсчётам: (пик к среднему, дБ; время нарастания фронта, lg с; центр спектра удара, кГц).
    Выстрел — фронт за доли миллисекунды и широкий спектр; удар весла, всплеск рыбы — медленнее и ниже."""
    a = np.abs(x)
    env = np.convolve(a, np.ones(16) / 16, mode="same")              # огибающая ~1 мс
    i = int(np.argmax(env))
    crest = 20 * np.log10(a.max() / (np.sqrt(np.mean(x * x)) + 1e-9) + 1e-9)
    lo = max(0, i - 1600)
    below = np.nonzero(env[lo:i] < 0.1 * env[i])[0]
    rise = (i - (lo + below[-1])) / SR if len(below) else 0.1
    seg = x[max(0, i - 128):max(0, i - 128) + 1024]
    seg = np.pad(seg, (0, 1024 - len(seg))) * np.hanning(1024)
    sp = np.abs(np.fft.rfft(seg)) ** 2
    cen = float((sp * np.fft.rfftfreq(1024, 1 / SR)).sum() / (sp.sum() + 1e-12))
    return float(crest), float(np.log10(rise + 1e-4)), cen / 1000


EVENT_DIM = N_MELS * 4 + 13
N_CEP = 24
N_HARM = 24


def _detrend(f: np.ndarray, db: np.ndarray) -> np.ndarray:
    """Убрать наклон (дБ на герц): дальность гасит высокие частоты ровно по прямой — катер от неё не меняется."""
    k = np.polyfit(f, db, 1)
    return db - np.polyval(k, f)


def vessel_features(x: np.ndarray) -> np.ndarray:
    """Признаки мотора для отпечатка катера: огибающая спектра (резонансы) и профиль гармоник,
    без наклона спектра — от дальности до буя отпечаток почти не зависит."""
    x = _common(x)
    psd = welch_db(x)
    fr = np.fft.rfftfreq(WELCH, 1 / SR)
    sel = (fr >= 30) & (fr <= 4000)
    band = _detrend(fr[sel], psd[sel])
    c = np.fft.irfft(band - band.mean())[1:N_CEP + 1]                   # кепстр огибающей: резонансы корпуса
    f0, _ = f0_cepstrum(psd, 15, 420)
    df = fr[1]
    hf, harm = [], []
    for k in range(1, N_HARM + 1):
        i = int(round(k * f0 / df))
        if i + 3 >= len(psd) or k * f0 > 4500:
            break
        hf.append(k * f0)
        harm.append(psd[max(0, i - 2):i + 3].max())
    h = _detrend(np.array(hf), np.array(harm)) if len(harm) > 2 else np.zeros(len(harm))
    h = np.pad(h - h.max(), (0, N_HARM - len(h)), constant_values=-30) if len(h) else np.full(N_HARM, -30.0)
    L = logmel(x)
    m = _detrend(mel_centers(), L.mean(0))
    return np.concatenate([c, h / 10, m / 10, [np.log(f0)]]).astype(np.float32)


VESSEL_DIM = N_CEP + N_HARM + N_MELS + 1


def rms_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-9))
