"""404 · API: буи, звук и нейросеть, алерты, прогноз и живые обновления для дашборда.

Запуск: uvicorn app.main:app --reload --port 8000  (из папки api/)

Окружение:
  DATA_DIR     папка базы SQLite и звуковых улик (по умолчанию api/data)
  BUOY_TOKEN   если задан — буи присылают звук и пульс с заголовком Authorization: Bearer <токен>
  WEATHER=0    не ходить в Open-Meteo (прогноз по сезонной модели)
  SIM_HEARTBEAT=0  буи без железа не «живут» сами: связь — только по настоящим пульсам и клипам
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import secrets
import uuid
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .audio import dsp, lab
from .audio.dsp import AudioError
from .models import Alert, AlertIn, AlertPatch, Buoy, ChainCheck, ClipResult, Forecast, Heartbeat, ModelInfo, NightForecast, State, Stats, Weather
from .sim import Sim
from .store import Clips, Store
from .weather import OpenMeteo
from .world import ARCHIVE_VESSELS, ModelMissing, World

log = logging.getLogger("404")
API_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("DATA_DIR") or API_DIR / "data")
BUOY_TOKEN = os.getenv("BUOY_TOKEN", "")
MAX_CLIP_BYTES = 10_000_000

weather = OpenMeteo() if os.getenv("WEATHER", "1") != "0" else None
world = World(store=Store(DATA_DIR / "404.db"), clips=Clips(DATA_DIR / "clips"), weather=weather)
clients: set[WebSocket] = set()


async def publish() -> None:
    """Разослать снимок состояния всем открытым дашбордам."""
    if not clients:
        return
    payload = world.state().model_dump_json()
    dead = []
    for ws in list(clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


sim = Sim(world, publish)


async def weather_loop() -> None:
    while True:
        if await asyncio.to_thread(weather.refresh):
            await publish()
        await asyncio.sleep(1800)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(sim.run())]
    if weather:
        tasks.append(asyncio.create_task(weather_loop()))
    yield
    sim.stop_demo()
    for t in tasks:
        t.cancel()


app = FastAPI(title="404 API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


def buoy_auth(authorization: str | None = Header(default=None)) -> None:
    """Звук и пульс принимаются только от своих буёв, если задан BUOY_TOKEN."""
    if not BUOY_TOKEN:
        return
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {BUOY_TOKEN}"):
        raise HTTPException(401, "Нужен токен буя: Authorization: Bearer <BUOY_TOKEN>")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "model": world.model is not None, "db": str(world.store.path) if world.store else None}


@app.get("/api/state", response_model=State)
def get_state() -> State:
    return world.state()


@app.get("/api/buoys", response_model=list[Buoy])
def get_buoys() -> list[Buoy]:
    return world.state().buoys


# ---------- звук буёв ----------
@app.post("/api/buoys/{buoy_id}/audio", response_model=ClipResult, dependencies=[Depends(buoy_auth)],
          openapi_extra={"requestBody": {"required": True, "content": {"audio/wav": {"schema": {"type": "string", "format": "binary"}}}}})
async def post_audio(buoy_id: str, request: Request, ts: datetime | None = None) -> ClipResult:
    """Клип с гидрофона буя (WAV, 2–30 с): нейросеть слушает, при моторе, выстреле или тишине — алерт со звуком-уликой.

    Пример: curl -X POST --data-binary @clip.wav -H 'Content-Type: audio/wav' localhost:8000/api/buoys/b04/audio
    """
    wav = await request.body()
    if len(wav) > MAX_CLIP_BYTES:
        raise HTTPException(413, "Клип больше 10 МБ")
    try:
        res = await asyncio.to_thread(world.ingest, buoy_id, wav, ts)
    except KeyError:
        raise HTTPException(404, f"Неизвестный буй: {buoy_id}")
    except AudioError as e:
        raise HTTPException(422, f"Клип не подходит: {e}")
    except ModelMissing as e:
        raise HTTPException(503, str(e))
    await publish()
    return res


@app.post("/api/buoys/{buoy_id}/heartbeat", response_model=Buoy, dependencies=[Depends(buoy_auth)])
async def post_heartbeat(buoy_id: str, hb: Heartbeat) -> Buoy:
    """Пульс буя: на связи, заряд батареи. Без пульса и клипов дольше минуты — тревога «нет связи»."""
    try:
        b = world.heartbeat(buoy_id, hb)
    except KeyError:
        raise HTTPException(404, f"Неизвестный буй: {buoy_id}")
    await publish()
    return b


@app.get("/api/clips")
def get_clips(limit: int = 50, buoy_id: str | None = None) -> list[dict]:
    """Последние клипы: что услышала нейросеть у каждого буя и почему был или не был алерт."""
    recs = [r for r in reversed(world.recent) if not buoy_id or r["buoy_id"] == buoy_id]
    return recs[: max(1, min(limit, 200))]


@app.get("/api/clips/{sha}/audio")
def clip_audio(sha: str) -> Response:
    if len(sha) != 64 or not all(c in "0123456789abcdef" for c in sha):
        raise HTTPException(400, "Нужен SHA-256 клипа")
    p = world.clips.path(sha)
    if p:
        return FileResponse(p, media_type="audio/wav")
    wav = world.clips.get(sha)
    if wav is None:
        raise HTTPException(404, "Клипа нет")
    return Response(wav, media_type="audio/wav")


@app.get("/api/model", response_model=ModelInfo)
def model_info() -> ModelInfo:
    """Карточка нейросети: на чём учили, пороги и проверка на данных, которых сеть не видела."""
    return ModelInfo(available=world.model is not None, meta=world.model.meta if world.model else None)


@app.get("/api/weather", response_model=Weather)
def get_weather() -> Weather:
    now = world.now()
    c = world.conditions(now)
    if weather:
        return weather.status(now, c.wind_ms, c.water_temp)
    return Weather(source="seasonal", fetched_at=None, wind_ms=c.wind_ms, water_temp=c.water_temp)


# ---------- лаборатория нейросети ----------
LAB: OrderedDict[str, bytes] = OrderedDict()            # последние разобранные записи — чтобы их можно было послушать


class LabScene(BaseModel):
    preset: Literal["motor-archive", "motor-new", "shot", "night", "silence", "voices", "imitation", "mouth-motor", "room", "claps",
                    "thunder", "wave", "airplane", "oar", "fish", "rain"]
    medium: Literal["water", "air"] = Field(default="water", description="Где микрофон: гидрофон буя под водой или в воздухе")
    vessel: Literal["boat-A", "boat-B", "boat-C"] = "boat-A"
    duration_s: float = Field(default=12, ge=4, le=30)
    snr_db: float = Field(default=10, ge=-10, le=30, description="Громкость события над фоном")
    activity: float = Field(default=0.7, ge=0, le=1, description="Живость природы")
    seed: int = Field(default=1, ge=0)


def _need_model():
    if not world.model:
        raise HTTPException(503, "Нейросеть не обучена: запустите tools/ml/train.py")
    return world.model


def _lab_keep(wav: bytes) -> str:
    lid = uuid.uuid4().hex[:12]
    LAB[lid] = wav
    while len(LAB) > 24:
        LAB.popitem(last=False)
    return lid


def _lab_run(x: np.ndarray, wav: bytes, extra: dict, medium: str = "water") -> dict:
    """Разбор для лаборатории. Пороги — по среде записи: гидрофон под водой или микрофон в воздухе."""
    m = _need_model()
    th = world.thresholds if medium == "water" else world.thresholds_air
    res = lab.analyze(m, x, th, world.vessels, world.match_threshold, world.vessel_cut)
    return {"id": _lab_keep(wav), **extra, "medium": medium, **res}


@app.get("/api/lab/presets")
def lab_presets() -> dict:
    return {"presets": [{"id": k, "title": v} for k, v in lab.PRESETS.items()], "archive": list(ARCHIVE_VESSELS)}


@app.post("/api/lab/scene")
async def lab_scene(p: LabScene) -> dict:
    """Синтезировать сцену (мотор, выстрел, тишина, помехи) и разобрать её нейросетью. Ничего не меняет в системе."""
    _need_model()

    def run():
        sc = lab.scene(p.preset, vessel_seed=ARCHIVE_VESSELS[p.vessel] if p.preset == "motor-archive" else None,
                       duration=p.duration_s, snr_db=p.snr_db, activity=p.activity, seed=p.seed, medium=p.medium)
        return _lab_run(sc.x, dsp.write_wav(sc.x), {"source": "scene", "title": sc.title, "truth": sc.truth, "marks": sc.marks,
                                                     "vessel": p.vessel if p.preset == "motor-archive" else None},
                       p.medium)
    return await asyncio.to_thread(run)


@app.post("/api/lab/analyze", openapi_extra={"requestBody": {"required": True, "content": {"audio/wav": {"schema": {"type": "string", "format": "binary"}}}}})
async def lab_analyze(request: Request, name: str | None = None, medium: Literal["water", "air"] = "air") -> dict:
    """Разобрать свой звук (WAV до 30 с): всё, что видит и решает нейросеть, без тревог.
    medium — где записан звук: по умолчанию микрофон в воздухе; water — запись гидрофона."""
    _need_model()
    wav = await request.body()
    if len(wav) > MAX_CLIP_BYTES:
        raise HTTPException(413, "Файл больше 10 МБ")
    try:
        x = dsp.read_wav(wav)
    except AudioError as e:
        raise HTTPException(422, f"Звук не подходит: {e}")
    return await asyncio.to_thread(_lab_run, x, wav, {"source": "upload", "title": name or "Ваша запись", "truth": None, "marks": []},
                                   medium)


@app.post("/api/lab/clip/{sha}")
async def lab_clip(sha: str) -> dict:
    """Разобрать клип, который прислал буй (из журнала клипов)."""
    _need_model()
    wav = world.clips.get(sha)
    if wav is None:
        raise HTTPException(404, "Клипа нет")
    rec = next((r for r in world.recent if r["sha256"] == sha), None)
    b = world.buoys.get(rec["buoy_id"]) if rec else None
    title = f"Клип буя {b.name}" if b else "Клип буя"
    return await asyncio.to_thread(_lab_run, dsp.read_wav(wav), wav, {"source": "buoy", "title": title, "truth": None, "marks": [],
                                                                       "sha256": sha, "ts": rec["ts"] if rec else None}, "water")


@app.get("/api/lab/audio/{lid}")
def lab_audio(lid: str) -> Response:
    wav = LAB.get(lid)
    if wav is None:
        raise HTTPException(404, "Запись устарела — разберите её заново")
    return Response(wav, media_type="audio/wav")


# ---------- алерты ----------
@app.get("/api/alerts", response_model=list[Alert])
def get_alerts(limit: int = 30) -> list[Alert]:
    return sorted(world.alerts, key=lambda a: a.ts, reverse=True)[:limit]


@app.post("/api/alerts", response_model=Alert, status_code=201)
async def post_alert(data: AlertIn) -> Alert:
    """Событие напрямую (без звука): от внешнего детектора или для проверки."""
    try:
        a = world.add_alert(data)
    except KeyError:
        raise HTTPException(404, f"Неизвестный буй: {data.buoy_id}")
    await publish()
    return a


@app.patch("/api/alerts/{alert_id}", response_model=Alert)
async def patch_alert(alert_id: str, body: AlertPatch) -> Alert:
    try:
        a = world.patch_alert(alert_id, body.status)
    except KeyError:
        raise HTTPException(404, f"Нет алерта {alert_id}")
    await publish()
    return a


@app.get("/api/alerts/{alert_id}/audio")
def alert_audio(alert_id: str) -> Response:
    """Звук-улика алерта: тот самый клип, хэш которого записан в цепочку."""
    a = next((x for x in world.alerts if x.id == alert_id), None)
    if not a:
        raise HTTPException(404, f"Нет алерта {alert_id}")
    if not a.audio_sha256:
        raise HTTPException(404, "У этого алерта нет звука")
    return clip_audio(a.audio_sha256)


# ---------- прогноз и аналитика ----------
@app.get("/api/forecast", response_model=Forecast)
def get_forecast() -> Forecast:
    return world.forecast()


@app.get("/api/forecast/nights", response_model=list[NightForecast])
def get_nights(days: int = 14) -> list[NightForecast]:
    """Риск на ближайшие ночи — для планирования патрулей."""
    return world.nights(max(1, min(days, 60)))


@app.get("/api/stats", response_model=Stats)
def get_stats(days: int = 30) -> Stats:
    """Аналитика по последним ночам (в демо — вместе со сгенерированной историей)."""
    return world.stats(max(1, min(days, 60)))


@app.get("/api/evidence/verify", response_model=ChainCheck)
def verify() -> ChainCheck:
    """Проверка цепочки SHA-256 и звуковых улик: цела ли доказательная база."""
    return world.verify_chain()


# ---------- демо ----------
@app.post("/api/demo/run")
async def demo_run(calm_s: float = 4, warn_s: float = 8) -> dict:
    sim.start_demo(calm_s, warn_s)
    return {"started": True}


@app.post("/api/demo/reset")
async def demo_reset() -> dict:
    sim.stop_demo()
    world.reset()
    await publish()
    return {"reset": True}


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    await socket.accept()
    clients.add(socket)
    try:
        await socket.send_text(world.state().model_dump_json())
        while True:
            await socket.receive_text()  # клиент молчит; держим соединение
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(socket)


# Собранный фронтенд (web/dist) отдаётся тем же сервером — один процесс для деплоя
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
