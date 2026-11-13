"""Состояние системы: буи, алерты, катера, звук буёв, прогноз.

Алерты образуют цепочку SHA-256: хэш каждого включает хэш предыдущего и хэш звукового клипа,
поэтому подмена любой записи или звука ломает проверку. Данные хранятся в SQLite (store.py)
и переживают перезапуск; без базы — в памяти (тесты).

Звук буя проходит путь: клип → нейросеть (событие, живость природы, отпечаток мотора) →
ухо буя (порог, повторы, тишина) → алерт с уликой. Отпечаток мотора сверяется с архивом
катеров по косинусному сходству: «тот же катер, что был здесь 5 мая».
"""
from __future__ import annotations

import hashlib
import os
import json
import math
import random
from collections import deque
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

from . import forecast as fc
from . import geo, voice
from .audio import dsp, listener
from .audio import model as acoustic
from .audio import synth
from .models import (Alert, AlertIn, Buoy, ChainCheck, ClipResult, Forecast, Heartbeat, Match, NightForecast,
                     NightStat, Sector, State, Stats)
from .store import Clips, Store

TZ = ZoneInfo("Europe/Astrakhan")
GENESIS = "0" * 64
FP_DIM = 16                     # размер отпечатка без обученной модели (векторы — синтетические)
MATCH_THRESHOLD = 0.8
REGISTER_MIN_CONF = 0.9         # новый катер заносим в архив только по уверенному звуку
COHORT_Q = 0.995                # порог образа — не ниже 99,5-го перцентиля сходства со случайными чужими катерами
MERGE = {"motor": (timedelta(minutes=3), 12.0), "shot": (timedelta(minutes=1), 8.0)}   # одна тревога на соседние буи
OFFLINE_AFTER = timedelta(seconds=60)
HISTORY_NIGHTS = 60
_DEFAULT = object()

# Катера архива сценария: у каждого — своя «подпись» мотора (зерно синтезатора)
ARCHIVE_VESSELS = {"boat-A": 7001, "boat-B": 7002, "boat-C": 7003}

# Демо-история: где и что «слышали» буи. Веса держат сектор 7 самым горячим, 5 — вторым,
# как в сценарии защиты («Рекомендую усилить сектор 7»).
SYNTH_BUOY_WEIGHT = {"b01": 5, "b04": 5, "b09": 5, "b03": 3, "b05": 3}
SYNTH_KINDS = (("motor", 50), ("silence", 22), ("offline", 18), ("shot", 10))
SYNTH_HOURS = ((21, 1), (22, 2), (23, 3), (0, 4), (1, 4), (2, 3), (3, 2), (4, 1))


def night_of(ts: datetime) -> date:
    """Ночь, к которой относится момент: до полудня — ещё прошлая ночь."""
    t = ts.astimezone(TZ)
    return t.date() - timedelta(days=1) if t.hour < 12 else t.date()


def _unit(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def cosine(a: list[float], b: list[float]) -> float:
    a, b = _unit(a), _unit(b)
    return sum(x * y for x, y in zip(a, b))


def canonical(a: Alert) -> str:
    """Поля, которые фиксирует хэш (статус обработки и текст — нет: это не улика)."""
    body = {
        "id": a.id, "buoy_id": a.buoy_id, "kind": a.kind, "ts": a.ts.isoformat(),
        "lat": a.lat, "lon": a.lon, "confidence": a.confidence,
        "fingerprint": a.fingerprint,
        "match": a.match.model_dump(mode="json") if a.match else None,
        "prev_hash": a.prev_hash,
    }
    if a.audio_sha256:
        body["audio_sha256"] = a.audio_sha256
    return json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class ModelMissing(RuntimeError):
    """Нейросеть не обучена: нет api/app/audio/model.npz."""


# сколько хранить звук без тревоги (часы); 0 — не хранить. Звук тревог (улики) хранится всегда.
CLIP_RETENTION_HOURS = float(os.getenv("CLIP_RETENTION_HOURS", "24"))

class World:
    def __init__(self, clock=None, store: Store | None = None, clips: Clips | None = None, model=_DEFAULT, weather=None):
        self._clock = clock or (lambda: datetime.now(TZ))
        self.store = store
        self.clips = clips or Clips()
        self.model: acoustic.Acoustic | None = acoustic.load() if model is _DEFAULT else model
        th = (self.model.meta.get("thresholds", {}) if self.model else {})
        self.match_threshold = float(th.get("match", MATCH_THRESHOLD))
        # у каждого катера архива свой порог: насколько на него похожи случайные чужие (Z-норма)
        self.match_z = float(th["match_z"]) if self.model and self.model.cohort is not None and "match_z" in th else None
        base = float(th.get("event", 0.6))
        self.thresholds = {"motor": float(th.get("motor", base)), "shot": float(th.get("shot", base))}   # гидрофон буя
        # микрофон в воздухе (проверка на сайте): свои пороги — хлопки и звуки ртом в комнате не путают буй
        self.thresholds_air = {"motor": float(th.get("motor_air", self.thresholds["motor"])),
                               "shot": float(th.get("shot_air", self.thresholds["shot"]))}
        self.weather = weather
        self.reset(fresh=False)

    # ---------- время ----------
    def now(self) -> datetime:
        return self._clock()

    # ---------- начальное состояние ----------
    def reset(self, fresh: bool = True) -> None:
        """Начальное состояние. fresh=False — поднять сохранённое из базы, если оно есть."""
        self.ears: dict[str, listener.Ear] = {}
        self.recent: deque[dict] = deque(maxlen=200)
        self.override: fc.Conditions | None = None
        if self.store and not fresh and self.store.has_alerts():
            self._load()
            return
        now = self.now()
        rnd = random.Random(404)
        self.buoys: dict[str, Buoy] = {}
        for b in geo.BUOYS:
            self.buoys[b.id] = Buoy(
                id=b.id, name=b.name, lat=b.lat, lon=b.lon, sector=geo.sector_of(b.lat, b.lon),
                battery=rnd.randint(72, 100), last_seen=now, health=round(rnd.uniform(0.74, 0.9), 2),
            )
        self.vessels: dict[str, dict] = {}
        for vid, seed in ARCHIVE_VESSELS.items():
            vec = self._archive_vector(seed) if self.model else _unit([rnd.gauss(0, 1) for _ in range(FP_DIM)])
            self.vessels[vid] = {"vector": vec, "last_seen": None, "seen": 0}
        self.alerts: list[Alert] = []
        self._seq = 0
        self._seed_history(now)
        if self.store:
            self.store.clear()
            self.clips.clear()
            self.store.set_meta("vessel_model", self.model.meta.get("vessel_model") if self.model else "none")
            self.store.save_alerts(self.alerts)
            for vid, v in self.vessels.items():
                self.store.save_vessel(vid, v)
            for b in self.buoys.values():
                self.store.save_buoy(b)

    def _load(self) -> None:
        assert self.store
        self.alerts = self.store.load_alerts()
        self._seq = len(self.alerts)
        self.vessels = self.store.load_vessels()
        for v in self.vessels.values():
            v["last_seen"] = date.fromisoformat(v["last_seen"]) if v.get("last_seen") else None
        # сеть отпечатков сменилась — старые векторы несравнимы: архив катеров заводим заново
        mid = self.model.meta.get("vessel_model") if self.model else "none"
        if self.store.get_meta("vessel_model") != mid:
            rnd = random.Random(404)
            old = self.vessels
            self.vessels = {}
            for vid, seed in ARCHIVE_VESSELS.items():
                vec = self._archive_vector(seed) if self.model else _unit([rnd.gauss(0, 1) for _ in range(FP_DIM)])
                last = old.get(vid, {}).get("last_seen")
                self.vessels[vid] = {"vector": vec, "last_seen": last, "seen": 0}
            self.store.clear_vessels()
            for vid in self.vessels:
                self._save_vessel(vid)
            self.store.set_meta("vessel_model", mid)
        saved = self.store.load_buoys()
        self.buoys = {}
        for b in geo.BUOYS:                          # места и имена — из кода, состояние — из базы
            s = saved.get(b.id)
            self.buoys[b.id] = Buoy(id=b.id, name=b.name, lat=b.lat, lon=b.lon, sector=geo.sector_of(b.lat, b.lon),
                                    battery=s.battery if s else 90, last_seen=self.now(), health=s.health if s else 0.8)
        for rec in self.store.recent_clips(200)[::-1]:
            self.recent.append(rec)

    def _archive_vector(self, seed: int) -> list[float]:
        """Отпечаток катера архива: средний по трём записанным проходам (как будет в жизни)."""
        r = np.random.default_rng(seed)
        v = synth.vessel(seed)
        embs = [self.model.fingerprint(synth.scene(r, "motor", v=v, snr_db=18)[0]) for _ in range(3)]
        return _unit(list(np.mean(embs, axis=0)))

    def _past(self, now: datetime, month: int, day: int, hh: int, mm: int) -> datetime:
        d = datetime(now.year, month, day, hh, mm, tzinfo=TZ)
        return d if d < now else d.replace(year=now.year - 1)

    def _seed_history(self, now: datetime) -> None:
        """Архив прошлых событий: из него берутся «горячие» сектора и узнаваемые катера.

        Четыре опорных события сценария и сгенерированная демо-история за последние ночи
        (помечена synthetic: это не реальные данные заповедника).
        """
        hist = [
            (self._past(now, 4, 12, 23, 10), "b09", "motor", 0.91, "boat-B", False, 21),
            (self._past(now, 4, 20, 2, 5), "b01", "silence", 0.83, None, False, 34),
            (self._past(now, 5, 2, 22, 30), "b03", "shot", 0.88, None, False, 12),
            (self._past(now, 5, 5, 1, 40), "b04", "motor", 0.93, "boat-A", False, 17),
        ]
        hist += self._synthetic_history(now)
        for ts, bid, kind, conf, vid, synth_, react in sorted(hist, key=lambda h: h[0]):
            fp = self.vessels[vid]["vector"] if vid else None
            a = self._make_alert(AlertIn(buoy_id=bid, kind=kind, confidence=conf, ts=ts, fingerprint=fp), persist=False)
            a.status = "resolved"
            a.synthetic = synth_
            a.intercept_at = ts + timedelta(minutes=react)
            a.resolved_at = a.intercept_at + timedelta(minutes=25 + react)

    def _synthetic_history(self, now: datetime) -> list[tuple]:
        """Демо-история: в тёмные тёплые ночи событий больше — как предсказывает формула риска."""
        out = []
        ids = list(self.buoys)
        weights = [SYNTH_BUOY_WEIGHT.get(i, 1) for i in ids]
        tonight = night_of(now)
        for k in range(1, HISTORY_NIGHTS + 1):
            d = tonight - timedelta(days=k)
            rnd = random.Random(f"404-{d.isoformat()}")
            r = fc.risk(fc.conditions_for(datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ)))
            n = (rnd.random() < 0.12 + 0.55 * r) + (rnd.random() < 0.25 * r) + (rnd.random() < 0.08 * r)
            for _ in range(n):
                hour = rnd.choices([h for h, _ in SYNTH_HOURS], [w for _, w in SYNTH_HOURS])[0]
                day = d + timedelta(days=1) if hour < 12 else d
                ts = datetime(day.year, day.month, day.day, hour, rnd.randrange(60), tzinfo=TZ)
                kind = rnd.choices([k for k, _ in SYNTH_KINDS], [w for _, w in SYNTH_KINDS])[0]
                bid = rnd.choices(ids, weights)[0]
                react = round(min(60, max(4, rnd.lognormvariate(2.7, 0.45))))
                out.append((ts, bid, kind, round(rnd.uniform(0.7, 0.96), 2), None, True, react))
        return out

    # ---------- алерты ----------
    def _next_id(self, ts: datetime) -> str:
        self._seq += 1
        return f"A-{ts:%Y%m%d}-{self._seq:04d}"

    def vessel_cut(self, v: dict) -> float:
        """Порог сходства для этого образа по когорте случайных чужих катеров: не ниже их 99,5-го перцентиля
        и не ниже среднего + z разбросов. На катер с «типичным» мотором похожи многие — порог у него строже."""
        if self.match_z is None:
            return self.match_threshold
        s = self.model.cohort @ np.asarray(v["vector"], dtype=np.float32)
        return max(float(np.quantile(s, COHORT_Q)), float(s.mean() + self.match_z * s.std()))

    def _match(self, fp: list[float], ts: datetime, register: bool = True) -> Match | None:
        """Сверка отпечатка с архивом. Узнанный катер уточняет свой образ (среднее по проходам).
        Неузнанный заносится в архив как новый — только если звук уверенный (register).
        Решение — по запасу над порогом своего образа: у катеров с «типичным» мотором порог строже."""
        best = max(((cosine(fp, v["vector"]) - self.vessel_cut(v), cosine(fp, v["vector"]), vid) for vid, v in self.vessels.items()),
                   default=(-1.0, 0.0, None))
        margin, sim, vid = best
        if vid is None or margin < 0:
            if register:
                new_id = f"boat-{len(self.vessels) + 1:02d}"
                self.vessels[new_id] = {"vector": _unit(fp), "last_seen": ts.date(), "seen": 1}
                self._save_vessel(new_id)
            return None
        v = self.vessels[vid]
        seen = v["last_seen"]
        n = v.get("seen", 0)
        v["vector"] = _unit([(a * n + b) for a, b in zip(v["vector"], _unit(fp))]) if n else v["vector"]
        v["seen"] = n + 1
        v["last_seen"] = ts.date()
        self._save_vessel(vid)
        if seen is None:  # первое появление катера в архиве
            return None
        return Match(vessel_id=vid, last_seen=seen, similarity=round(sim, 2))

    def _save_vessel(self, vid: str) -> None:
        if self.store:
            self.store.save_vessel(vid, self.vessels[vid])

    def _make_alert(self, data: AlertIn, *, audio_sha: str | None = None, probs: dict | None = None,
                    source: str = "manual", persist: bool = True) -> Alert:
        b = self.buoys[data.buoy_id]
        ts = data.ts or self.now()
        match = (self._match(data.fingerprint, ts, register=data.confidence >= REGISTER_MIN_CONF)
                 if data.fingerprint and data.kind == "motor" else None)
        dist = round(geo.haversine_km(*geo.INSPECTOR, b.lat, b.lon), 1)
        msg = voice.alert_message(data.kind, b.name, dist, match.last_seen if match else None,
                                  round(match.similarity * 100) if match else None, ts.date())
        prev = self.alerts[-1].hash if self.alerts else GENESIS
        a = Alert(id=self._next_id(ts), buoy_id=b.id, buoy_name=b.name, sector=b.sector, kind=data.kind,
                  ts=ts, lat=b.lat, lon=b.lon, confidence=round(data.confidence, 2), message=msg,
                  distance_km=dist, match=match,
                  fingerprint=[round(x, 5) for x in data.fingerprint] if data.fingerprint else None,
                  prev_hash=prev, hash="", audio_sha256=audio_sha, probs=probs, source=source)  # type: ignore[arg-type]
        a.hash = sha256(canonical(a))
        self.alerts.append(a)
        if persist and self.store:
            self.store.save_alert(a, self._seq)
        return a

    def add_alert(self, data: AlertIn) -> Alert:
        if data.buoy_id not in self.buoys:
            raise KeyError(data.buoy_id)
        return self._make_alert(data)

    def patch_alert(self, alert_id: str, status: str, actor: str | None = None) -> Alert:
        for i, a in enumerate(self.alerts):
            if a.id == alert_id:
                a.status = status  # type: ignore[assignment]
                if status == "intercept" and a.intercept_at is None:
                    a.intercept_at = self.now()
                    a.intercept_by = actor
                if status == "resolved" and a.resolved_at is None:
                    a.resolved_at = self.now()
                    a.resolved_by = actor
                if self.store:
                    self.store.save_alert(a, i + 1)
                return a
        raise KeyError(alert_id)

    def prune_clips(self) -> int:
        """Удалить звук без тревоги старше срока хранения. Звук тревог не трогаем — он в цепочке улик."""
        keep = {a.audio_sha256 for a in self.alerts if a.audio_sha256}
        return self.clips.prune(keep, max(CLIP_RETENTION_HOURS, 0) * 3600)

    def verify_chain(self) -> ChainCheck:
        """Цепочка хэшей и звук: каждый клип-улика сверяется со своим SHA-256."""
        prev, audio = GENESIS, 0
        for a in self.alerts:
            if a.prev_hash != prev or sha256(canonical(a)) != a.hash:
                return ChainCheck(ok=False, checked=len(self.alerts), broken_at=a.id, audio_checked=audio,
                                  reason="запись изменена после создания")
            if a.audio_sha256:
                wav = self.clips.get(a.audio_sha256)
                if wav is None or hashlib.sha256(wav).hexdigest() != a.audio_sha256:
                    return ChainCheck(ok=False, checked=len(self.alerts), broken_at=a.id, audio_checked=audio,
                                      reason="звуковой клип пропал" if wav is None else "звуковой клип подменён")
                audio += 1
            prev = a.hash
        return ChainCheck(ok=True, checked=len(self.alerts), audio_checked=audio)

    def fingerprint_like(self, vessel_id: str, similarity: float, seed: int = 7) -> list[float]:
        """Отпечаток с заданным сходством с известным катером (для демо и тестов)."""
        base = self.vessels[vessel_id]["vector"]
        rnd = random.Random(seed)
        noise = [rnd.gauss(0, 1) for _ in range(len(base))]
        dot = sum(x * y for x, y in zip(noise, base))
        orth = _unit([n - dot * b for n, b in zip(noise, base)])
        s = similarity
        return [s * b + math.sqrt(1 - s * s) * o for b, o in zip(base, orth)]

    # ---------- звук буёв ----------
    def ingest(self, buoy_id: str, wav: bytes, ts: datetime | None = None) -> ClipResult:
        """Клип с буя: нейросеть → ухо буя → (может быть) алерт с уликой. Звук хранится как есть."""
        if buoy_id not in self.buoys:
            raise KeyError(buoy_id)
        if not self.model:
            raise ModelMissing("нейросеть не обучена: запустите tools/ml/train.py")
        x = dsp.read_wav(wav)
        an = self.model.analyze(x)
        ts = ts or self.now()
        sha = hashlib.sha256(wav).hexdigest()          # звук сохраняем ниже — только когда он нужен (docs/audit/02-privacy.md)
        b = self.buoys[buoy_id]
        b.last_seen = ts
        ear = self.ears.setdefault(buoy_id, listener.Ear())
        prev_fp = ear.motor_fp if ear.motor_at else None
        kind, conf, note = listener.hear(ear, an, self.thresholds, ts)
        b.health = round(float(ear.health), 2)
        ear.motor_fp = an.fingerprint if an.event == "motor" else None
        fp = an.fingerprint
        if kind == "motor" and prev_fp and fp:              # мотор подтверждён двумя клипами — отпечаток по обоим
            fp = _unit([a + c for a, c in zip(prev_fp, fp)])
        if kind in MERGE:
            near = self._open_nearby(kind, b, ts)
            if near:
                kind, note = None, f"{note} — та же тревога, что у буя {near.buoy_name}"

        # звук тревоги — улика, хранится всегда; без тревоги — до срока CLIP_RETENTION_HOURS;
        # речь людей без тревоги не храним вовсе
        stored = bool(kind) or (an.event != "voice" and CLIP_RETENTION_HOURS > 0)
        if stored:
            self.clips.put(wav)
        elif an.event == "voice":
            note = f"{note} · речь — звук не хранится" if note else "речь — звук не хранится"
        alert = None
        if kind:
            alert = self._make_alert(
                AlertIn(buoy_id=buoy_id, kind=kind, confidence=max(0.01, conf), ts=ts,  # type: ignore[arg-type]
                        fingerprint=fp if kind == "motor" else None),
                audio_sha=sha, probs=an.probs, source="audio")
        res = ClipResult(sha256=sha, buoy_id=buoy_id, ts=ts, event=an.event, confidence=an.confidence,  # type: ignore[arg-type]
                         probs=an.probs, activity=an.activity, level_db=an.level_db, f0_hz=an.f0_hz, novelty=an.novelty,
                         alert=alert, note=note)
        rec = res.model_dump(mode="json", exclude={"alert"})
        rec["alert_id"] = alert.id if alert else None
        rec["stored"] = stored
        self.recent.append(rec)
        if self.store:
            self.store.save_clip(rec)
            self.store.save_buoy(b)
        return res

    def _open_nearby(self, kind: str, b: Buoy, ts: datetime) -> Alert | None:
        """Открытая тревога того же вида у соседнего буя за последние минуты: один мотор слышат несколько буёв."""
        window, radius = MERGE[kind]
        for a in reversed(self.alerts):
            if ts - a.ts > window:
                break
            if a.kind == kind and a.status != "resolved" and a.buoy_id != b.id \
                    and geo.haversine_km(a.lat, a.lon, b.lat, b.lon) <= radius:
                return a
        return None

    def heartbeat(self, buoy_id: str, hb: Heartbeat) -> Buoy:
        b = self.buoys[buoy_id]
        b.last_seen = self.now()
        if hb.battery is not None:
            b.battery = hb.battery
        if self.store:
            self.store.save_buoy(b)
        return b

    def watch(self) -> list[Alert]:
        """Буй замолчал по связи дольше минуты — одна тревога «нет связи», пока он не вернётся."""
        out = []
        now = self.now()
        for b in self.buoys.values():
            ear = self.ears.setdefault(b.id, listener.Ear())
            lost = now - b.last_seen > OFFLINE_AFTER
            if lost and not ear.offline_alerted:
                ear.offline_alerted = True
                out.append(self._make_alert(AlertIn(buoy_id=b.id, kind="offline", confidence=1.0, ts=now), source="system"))
            elif not lost:
                ear.offline_alerted = False
        return out

    # ---------- прогноз ----------
    def conditions(self, dt: datetime) -> fc.Conditions:
        """Условия ночи: луна и день недели — расчёт; ветер и вода — Open-Meteo, иначе сезонная модель."""
        w = self.weather
        wind = w.wind_at(dt) if w else None
        water = w.water_at(dt) if w else None
        return fc.conditions_for(dt, wind if wind is not None else 4.0, water)

    def weather_source(self, dt: datetime) -> str:
        return "open-meteo" if self.weather and self.weather.wind_at(dt) is not None else "seasonal"

    def hot_sectors(self, k: int = 2) -> list[int]:
        counts: dict[int, int] = {}
        for a in self.alerts:
            counts[a.sector] = counts.get(a.sector, 0) + 1
        return [s for s, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]

    def forecast(self) -> Forecast:
        now = self.now()
        c = self.override or self.conditions(now)
        r = fc.risk(c)
        hot = self.hot_sectors()
        lv = fc.level(r)
        return Forecast(ts=now, moon_phase=c.phase, moon_illumination=round(c.illumination, 2),
                        weekday=fc.WEEKDAYS[c.weekday], water_temp=c.water_temp, wind_ms=c.wind_ms,
                        risk=r, level=lv, hot_sectors=hot if lv != "low" else [],
                        message=fc.message(c, r, hot), demo=self.override is not None,
                        weather="seasonal" if self.override else self.weather_source(now))  # type: ignore[arg-type]

    # ---------- режим дашборда ----------
    def mode(self, f: Forecast | None = None) -> str:
        if any(a.status == "intercept" for a in self.alerts):
            return "intercept"
        if any(a.status == "new" for a in self.alerts):
            return "alarm"
        f = f or self.forecast()
        return "alertness" if f.level == "high" else "calm"

    # ---------- такт симуляции ----------
    def tick(self, rnd: random.Random, heartbeat: bool = True) -> None:
        """Такт симулятора: буи без железа «живут» (связь, заряд); здоровье от звука не трогаем."""
        now = self.now()
        for b in self.buoys.values():
            if heartbeat and b.status != "offline":
                b.last_seen = now
                b.battery = max(5, b.battery - (1 if rnd.random() < 0.02 else 0))
            ear = self.ears.get(b.id)
            if not (ear and ear.health is not None):
                b.health = round(min(0.95, max(0.4, b.health + rnd.uniform(-0.01, 0.01))), 2)

    def _buoy_status(self, b: Buoy, f: Forecast) -> str:
        if self.now() - b.last_seen > OFFLINE_AFTER:
            return "offline"
        if any(a.buoy_id == b.id and a.status in ("new", "intercept") for a in self.alerts):
            return "alert"
        if f.level == "high" and b.sector in f.hot_sectors:
            return "warn"
        return "ok"

    def state(self) -> State:
        f = self.forecast()
        for b in self.buoys.values():
            b.status = self._buoy_status(b, f)  # type: ignore[assignment]
        sectors = []
        for n in range(1, geo.ROWS * geo.COLS + 1):
            (s, w), (nn, e) = geo.sector_bounds(n)
            sectors.append(Sector(n=n, south=s, west=w, north=nn, east=e))
        return State(mode=self.mode(f), now=self.now(), buoys=list(self.buoys.values()),
                     alerts=sorted(self.alerts, key=lambda a: a.ts, reverse=True)[:30],
                     forecast=f, sectors=sectors, links=geo.nerve_links(),
                     inspector=geo.INSPECTOR, center=geo.MAP_CENTER)

    # ---------- аналитика ----------
    def stats(self, days: int = 30) -> Stats:
        """Сводка по последним ночам: события по ночам, типам, секторам, часам и скорость реакции."""
        tonight = night_of(self.now())
        first = tonight - timedelta(days=days - 1)
        window = [a for a in self.alerts if first <= night_of(a.ts) <= tonight]
        nights = []
        for k in range(days):
            d = first + timedelta(days=k)
            c = self.conditions(datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ))
            evs = [a for a in window if night_of(a.ts) == d]
            kinds: dict[str, int] = {}
            for a in evs:
                kinds[a.kind] = kinds.get(a.kind, 0) + 1
            nights.append(NightStat(date=d, risk=fc.risk(c), moon_illumination=round(c.illumination, 2),
                                    events=len(evs), by_kind=kinds))
        by_kind = {k: 0 for k, _ in SYNTH_KINDS}
        by_sector = {n: 0 for n in range(1, geo.ROWS * geo.COLS + 1)}
        by_hour = [0] * 24
        reactions = []
        for a in window:
            by_kind[a.kind] = by_kind.get(a.kind, 0) + 1
            by_sector[a.sector] += 1
            by_hour[a.ts.astimezone(TZ).hour] += 1
            done = a.intercept_at or a.resolved_at
            if done:
                reactions.append((done - a.ts).total_seconds() / 60)
        reactions.sort()
        median = None
        if reactions:
            m = len(reactions) // 2
            median = round(reactions[m] if len(reactions) % 2 else (reactions[m - 1] + reactions[m]) / 2, 1)
        return Stats(days=days, nights=nights, by_kind=by_kind, by_sector=by_sector, by_hour=by_hour,
                     total=len(window), reaction_median_min=median, synthetic=any(a.synthetic for a in window))

    def nights(self, days: int = 14) -> list[NightForecast]:
        """Прогноз риска на ближайшие ночи: настоящая луна, погода (Open-Meteo или сезонная), день недели."""
        tonight = night_of(self.now())
        out = []
        for k in range(days):
            d = tonight + timedelta(days=k)
            c = self.conditions(datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ))
            r = fc.risk(c)
            at = datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ)
            out.append(NightForecast(date=d, weekday=fc.WEEKDAYS[c.weekday], moon_phase=c.phase,
                                     moon_illumination=round(c.illumination, 2), water_temp=c.water_temp,
                                     risk=r, level=fc.level(r), wind_ms=c.wind_ms,
                                     weather=self.weather_source(at)))  # type: ignore[arg-type]
        return out
