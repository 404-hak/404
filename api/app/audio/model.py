"""Нейросети буя в работе: прямой проход многослойных перцептронов на numpy.

Обучение — tools/ml/train.py (scikit-learn); сюда приходят только веса (model.npz), поэтому
API не тянет тяжёлых библиотек и отвечает за миллисекунды. Три сети:
  events — что в клипе: фон, мотор, выстрел или голоса людей (softmax);
  bio    — живость природы 0…1 (лягушки, птицы, насекомые): из неё индекс здоровья и «тишина как улика»;
  vessel — отпечаток катера: последний скрытый слой сети, обученной различать катера,
           нормированный вектор; один катер — близкие векторы (косинус), разные — далёкие.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import dsp

MODEL_PATH = Path(__file__).with_name("model.npz")


@dataclass
class MLP:
    mean: np.ndarray
    scale: np.ndarray
    weights: list[np.ndarray]
    biases: list[np.ndarray]
    out: str                      # softmax | logistic | identity
    center: np.ndarray | None = None   # общий центр отпечатков: вычитаем, чтобы сходство различало катера

    def _hidden(self, x: np.ndarray) -> list[np.ndarray]:
        h = (np.atleast_2d(x) - self.mean) / self.scale
        acts = []
        for W, b in zip(self.weights[:-1], self.biases[:-1]):
            h = np.maximum(h @ W + b, 0)
            acts.append(h)
        return acts

    def forward(self, x: np.ndarray) -> np.ndarray:
        acts = self._hidden(x)
        z = (acts[-1] if acts else (np.atleast_2d(x) - self.mean) / self.scale) @ self.weights[-1] + self.biases[-1]
        if self.out == "softmax":
            z = np.exp(z - z.max(axis=1, keepdims=True))
            return z / z.sum(axis=1, keepdims=True)
        if self.out == "logistic":
            return 1 / (1 + np.exp(-z))
        return z

    def embed(self, x: np.ndarray) -> np.ndarray:
        """Последний скрытый слой без общего центра, нормированный: отпечаток."""
        h = self._hidden(x)[-1]
        if self.center is not None:
            h = h - self.center
        return h / (np.linalg.norm(h, axis=1, keepdims=True) + 1e-9)


def pack(prefix: str, scaler, net, out: str) -> dict:
    """Веса из scikit-learn (StandardScaler + MLP) → словарь массивов для model.npz."""
    d = {f"{prefix}_mean": scaler.mean_.astype(np.float32), f"{prefix}_scale": scaler.scale_.astype(np.float32),
         f"{prefix}_out": np.array(out)}
    for i, (W, b) in enumerate(zip(net.coefs_, net.intercepts_)):
        d[f"{prefix}_W{i}"] = W.astype(np.float32)
        d[f"{prefix}_b{i}"] = b.astype(np.float32)
    return d


def unpack(z, prefix: str) -> MLP:
    n = sum(1 for k in z.files if k.startswith(f"{prefix}_W"))
    center = z[f"{prefix}_center"] if f"{prefix}_center" in z.files else None
    return MLP(z[f"{prefix}_mean"], z[f"{prefix}_scale"], [z[f"{prefix}_W{i}"] for i in range(n)],
               [z[f"{prefix}_b{i}"] for i in range(n)], str(z[f"{prefix}_out"]), center)


@dataclass
class Analysis:
    event: str                    # background | motor | shot | voice
    confidence: float             # вероятность этого события
    probs: dict[str, float]
    activity: float               # живость природы 0…1
    fingerprint: list[float] | None = None
    f0_hz: float | None = None
    level_db: float = 0.0
    novelty: float = 0.0          # насколько звук непривычен для сети: больше 1 — такому она не училась
    unfamiliar: bool = False


@dataclass
class Acoustic:
    events: MLP
    bio: MLP
    vessel: MLP
    meta: dict = field(default_factory=dict)
    cohort: np.ndarray | None = None      # отпечатки случайных чужих катеров — для порога каждого образа (Z-норма)
    novelty_comp: np.ndarray | None = None   # главные компоненты обучающих признаков — датчик непривычного звука
    novelty_sd: np.ndarray | None = None

    def novelty(self, e: np.ndarray) -> np.ndarray:
        """Непривычность клипа: расстояние до обучающих звуков (в главных компонентах и вне их) в долях порога;
        больше 1 — дальше, чем 99,5 % проверочных клипов: ответ сети на таком звуке ненадёжен."""
        if self.novelty_comp is None:
            return np.zeros(len(np.atleast_2d(e)))
        z = (np.atleast_2d(e) - self.events.mean) / self.events.scale
        p = z @ self.novelty_comp.T
        d2 = ((p / self.novelty_sd) ** 2).sum(1)
        res = ((z - p @ self.novelty_comp) ** 2).sum(1)
        th = self.meta["thresholds"]
        return np.maximum(d2 / th["novelty_d2"], res / th["novelty_res"])

    def znorm(self, vec) -> tuple[float, float]:
        """Насколько на этот образ похожи случайные чужие катера: (среднее, разброс) сходства."""
        if self.cohort is None:
            return 0.0, 1.0
        s = self.cohort @ np.asarray(vec, dtype=np.float32)
        return float(s.mean()), float(s.std() + 1e-6)

    @property
    def classes(self) -> list[str]:
        return self.meta["classes"]

    def analyze(self, x: np.ndarray) -> Analysis:
        """Клип 16 кГц → событие, уверенность, живость природы; для мотора — отпечаток катера."""
        e = dsp.event_features(x)
        p = self.events.forward(e)[0]
        k = int(np.argmax(p))
        act = float(np.clip(self.bio.forward(e)[0, 0], 0, 1))
        nov = float(self.novelty(e)[0])
        a = Analysis(event=self.classes[k], confidence=round(float(p[k]), 3),
                     probs={c: round(float(v), 3) for c, v in zip(self.classes, p)}, activity=round(act, 3),
                     level_db=round(dsp.rms_db(x), 1), novelty=round(nov, 2), unfamiliar=nov > 1)
        if a.event == "motor":
            v = dsp.vessel_features(x)
            a.fingerprint = [round(float(t), 5) for t in self.vessel.embed(v)[0]]
            a.f0_hz = round(float(np.exp(v[-1])), 1)
        return a

    def fingerprint(self, x: np.ndarray) -> list[float]:
        return [float(t) for t in self.vessel.embed(dsp.vessel_features(x))[0]]


@lru_cache(maxsize=2)
def load(path: str | None = None) -> Acoustic | None:
    """Модель из model.npz; None, если её ещё не обучили (API тогда работает без аудио-распознавания)."""
    p = Path(path) if path else MODEL_PATH
    if not p.exists():
        return None
    with np.load(p, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        v = unpack(z, "vessel")
        # отпечаток сети отпечатков: если веса сменились, старые векторы архива несравнимы с новыми
        meta["vessel_model"] = hashlib.sha1(b"".join(w.tobytes() for w in v.weights[:2])).hexdigest()[:12]
        cohort = z["vessel_cohort"] if "vessel_cohort" in z.files else None
        nc = z["novelty_comp"] if "novelty_comp" in z.files else None
        ns = z["novelty_sd"] if "novelty_sd" in z.files else None
        return Acoustic(unpack(z, "events"), unpack(z, "bio"), v, meta, cohort, nc, ns)
