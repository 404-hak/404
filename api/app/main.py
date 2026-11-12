"""404 · API: буи, алерты, прогноз и живые обновления для дашборда.

Запуск: uvicorn app.main:app --reload --port 8000  (из папки api/)
"""
from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .models import Alert, AlertIn, AlertPatch, Buoy, ChainCheck, Forecast, NightForecast, State, Stats
from .sim import Sim
from .world import World

world = World()
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


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(sim.run())
    yield
    sim.stop_demo()
    task.cancel()


app = FastAPI(title="404 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/state", response_model=State)
def get_state() -> State:
    return world.state()


@app.get("/api/buoys", response_model=list[Buoy])
def get_buoys() -> list[Buoy]:
    return world.state().buoys


@app.get("/api/alerts", response_model=list[Alert])
def get_alerts(limit: int = 30) -> list[Alert]:
    return sorted(world.alerts, key=lambda a: a.ts, reverse=True)[:limit]


@app.post("/api/alerts", response_model=Alert, status_code=201)
async def post_alert(data: AlertIn) -> Alert:
    """Приём события от буя (или от аудио-модуля)."""
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
    """Проверка цепочки SHA-256: цела ли доказательная база."""
    return world.verify_chain()


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
