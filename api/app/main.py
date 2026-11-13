"""404 · API: буи, звук и нейросеть, алерты, прогноз и живые обновления для дашборда.

Запуск: uvicorn app.main:app --reload --port 8000  (из папки api/)

Окружение:
  DATA_DIR     папка базы SQLite и звуковых улик (по умолчанию api/data)
  BUOY_TOKEN   если задан — буи присылают звук и пульс с заголовком Authorization: Bearer <токен>
  BUOY_TOKENS  свой токен у каждого буя: "b01:токен1,b02:токен2" (буй из списка принимается только со своим)
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  тревоги — ещё и сообщением в Telegram (app/notify.py)
  WEATHER=0    не ходить в Open-Meteo (прогноз по сезонной модели)
  SIM_HEARTBEAT=0  буи без железа не «живут» сами: связь — только по настоящим пульсам и клипам
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
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

from . import notify, security
from .accounts import ROLE_TITLE, ROLES, SESSION_DAYS, Accounts
from .audio import dsp, lab
from .ratelimit import Limiter
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
DEMO = os.getenv("DEMO", "1") != "0"          # DEMO=0 на настоящих данных: демо-сброс стирает базу и улики
MAX_WS_CLIENTS = int(os.getenv("MAX_WS_CLIENTS", "200"))
LAB_MAX_BYTES = 60_000_000                     # разобранные в лаборатории записи держим в памяти не больше этого

weather = OpenMeteo() if os.getenv("WEATHER", "1") != "0" else None
ANCHOR_EVERY_H = float(os.getenv("ANCHOR_EVERY_H", "24"))   # как часто ставить печать цепочки
ANCHOR_WEBHOOK = os.getenv("ANCHOR_WEBHOOK", "")             # куда отправлять печать вне сервера (POST JSON)


def _move_old_demo_data() -> None:
    """Раньше демо жило в 404.db. Если там только сгенерированные тревоги — это демо: переносим в 404-demo.db,
    чтобы рабочая база (DEMO=0) начиналась чистой (docs/audit/06-backend.md, B4)."""
    old, new = DATA_DIR / "404.db", DATA_DIR / "404-demo.db"
    if not DEMO or new.exists() or not old.exists():
        return
    import json
    import sqlite3
    try:
        with contextlib.closing(sqlite3.connect(old)) as db:
            rows = db.execute("SELECT data FROM alerts").fetchall()
        if rows and all(json.loads(d).get("synthetic") for (d,) in rows):
            for suffix in ("", "-wal", "-shm"):
                p = DATA_DIR / f"404.db{suffix}"
                if p.exists():
                    p.rename(DATA_DIR / f"404-demo.db{suffix}")
            if (DATA_DIR / "clips").is_dir() and not (DATA_DIR / "clips-demo").exists():
                (DATA_DIR / "clips").rename(DATA_DIR / "clips-demo")
    except Exception as e:  # noqa: BLE001 — не мешаем запуску
        log.warning("404: не удалось перенести старые демо-данные: %s", e)


_move_old_demo_data()
# демо и настоящие данные — в разных базах: сброс демо не может задеть рабочие тревоги и улики
world = World(store=Store(DATA_DIR / ("404-demo.db" if DEMO else "404.db")),
              clips=Clips(DATA_DIR / ("clips-demo" if DEMO else "clips")), weather=weather, demo=DEMO)
clients: set[WebSocket] = set()
accounts = Accounts(Store(DATA_DIR / "404-team.db"))   # команда и журнал действий — общие для демо и работы
security.ACCOUNTS = accounts
login_ip = Limiter(20, 600)          # попыток входа с одного адреса за 10 минут
login_fail = Limiter(6, 900)         # неудачных паролей на один логин за 15 минут
lab_ip = Limiter(30, 60)             # разборов нейросетью с одного адреса в минуту


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def user_of(request: Request) -> dict:
    """Кто делает запрос (кладёт security.AccessGate); без входа и ссылки — режим показа с полными правами."""
    return getattr(request.state, "user", None) or security.OPEN_USER


def need(role: str):
    """Зависимость: у пользователя роль не ниже role (наблюдатель < дежурный < старший)."""
    def check(request: Request) -> dict:
        u = user_of(request)
        if ROLES.get(u["role"], -1) < ROLES[role]:
            raise HTTPException(403, f"Нужна роль «{ROLE_TITLE[role]}»")
        return u
    return check


def lab_limit(request: Request) -> None:
    if not lab_ip.allow(client_ip(request)):
        raise HTTPException(429, "Слишком много разборов подряд — подождите минуту")


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


def alerts_head() -> str:
    return world.alerts[-1].hash if world.alerts else "0" * 64


def seal_now(actor: str) -> dict:
    """Поставить печать и (если задан ANCHOR_WEBHOOK) отправить её вне сервера."""
    a = accounts.anchor(alerts_head(), len(world.alerts))
    accounts.record(actor, "evidence.seal", a["seal"][:16], alerts=len(world.alerts))
    if ANCHOR_WEBHOOK:
        import json
        import urllib.request
        with contextlib.suppress(Exception):
            req = urllib.request.Request(ANCHOR_WEBHOOK, data=json.dumps({"project": "404", **a}).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=10).close()
    return a


async def anchor_loop() -> None:
    """Печать цепочки раз в ANCHOR_EVERY_H часов (если с прошлой печати что-то изменилось)."""
    await asyncio.sleep(60)
    while True:
        last = accounts.anchors()[-1:] or [{}]
        if last[0].get("alerts_head") != alerts_head() or last[0].get("journal_head") != accounts.head():
            with contextlib.suppress(Exception):
                await asyncio.to_thread(seal_now, "сервер")
        await asyncio.sleep(max(1.0, ANCHOR_EVERY_H) * 3600)


async def clip_janitor() -> None:
    """Раз в час — удалить звук без тревоги старше CLIP_RETENTION_HOURS (речь и шум у воды не копятся)."""
    while True:
        with contextlib.suppress(Exception):
            gone = await asyncio.to_thread(world.prune_clips)
            if gone:
                log.info("404: удалено старых клипов без тревоги: %d", gone)
        await asyncio.sleep(3600)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    security.startup_warnings()
    world.on_alert = notify.from_env()
    tasks = [asyncio.create_task(sim.run()), asyncio.create_task(clip_janitor()), asyncio.create_task(anchor_loop())]
    if weather:
        tasks.append(asyncio.create_task(weather_loop()))
    yield
    sim.stop_demo()
    for t in tasks:
        t.cancel()


app = FastAPI(title="404 API", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
# снаружи внутрь: заголовки безопасности → доступ по ссылке → сжатие → приложение
app.add_middleware(security.Compress)
app.add_middleware(security.AccessGate)
app.add_middleware(security.Hardening)


async def read_body(request: Request, limit: int = MAX_CLIP_BYTES) -> bytes:
    """Тело запроса с пределом: по Content-Length отказываем сразу, иначе читаем потоком и обрываем на пределе."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, f"Файл больше {limit // 1_000_000} МБ")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, f"Файл больше {limit // 1_000_000} МБ")
        chunks.append(chunk)
    return b"".join(chunks)


SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def buoy_auth(buoy_id: str, authorization: str | None = Header(default=None)) -> None:
    """Звук и пульс принимаются только от своих буёв. У буя из BUOY_TOKENS — только его собственный токен;
    у остальных — общий BUOY_TOKEN. Ничего не задано — открыто (режим показа)."""
    own = security.buoy_tokens().get(buoy_id)
    token = own or BUOY_TOKEN
    if not token:
        if security.buoy_tokens():                      # список задан, а этого буя в нём нет
            raise HTTPException(401, f"Буй {buoy_id} не зарегистрирован в BUOY_TOKENS")
        return
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Нужен токен буя: Authorization: Bearer <токен этого буя>")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "model": world.model is not None, "db": world.store is not None}


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
    wav = await read_body(request)
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
    if not SHA_RE.match(sha):
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
    while len(LAB) > 24 or (len(LAB) > 1 and sum(map(len, LAB.values())) > LAB_MAX_BYTES):
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


@app.post("/api/lab/scene", dependencies=[Depends(need("duty")), Depends(lab_limit)])
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


@app.post("/api/lab/analyze", openapi_extra={"requestBody": {"required": True, "content": {"audio/wav": {"schema": {"type": "string", "format": "binary"}}}}}, dependencies=[Depends(need("duty")), Depends(lab_limit)])
async def lab_analyze(request: Request, name: str | None = None, medium: Literal["water", "air"] = "air") -> dict:
    """Разобрать свой звук (WAV до 30 с): всё, что видит и решает нейросеть, без тревог.
    medium — где записан звук: по умолчанию микрофон в воздухе; water — запись гидрофона."""
    _need_model()
    wav = await read_body(request)
    try:
        x = dsp.read_wav(wav)
    except AudioError as e:
        raise HTTPException(422, f"Звук не подходит: {e}")
    return await asyncio.to_thread(_lab_run, x, wav, {"source": "upload", "title": name or "Ваша запись", "truth": None, "marks": []},
                                   medium)


@app.post("/api/lab/clip/{sha}", dependencies=[Depends(need("duty")), Depends(lab_limit)])
async def lab_clip(sha: str) -> dict:
    """Разобрать клип, который прислал буй (из журнала клипов)."""
    _need_model()
    if not SHA_RE.match(sha):
        raise HTTPException(400, "Нужен SHA-256 клипа")
    wav = world.clips.get(sha)
    if wav is None:
        raise HTTPException(404, "Клипа нет")
    rec = next((r for r in world.recent if r["sha256"] == sha), None)
    b = world.buoys.get(rec["buoy_id"]) if rec else None
    title = f"Клип буя {b.name}" if b else "Клип буя"
    try:
        x = dsp.read_wav(wav)
    except AudioError as e:
        raise HTTPException(422, f"Клип не подходит: {e}")
    return await asyncio.to_thread(_lab_run, x, wav, {"source": "buoy", "title": title, "truth": None, "marks": [],
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
    return sorted(world.alerts, key=lambda a: a.ts, reverse=True)[: max(1, min(limit, 500))]


@app.post("/api/alerts", response_model=Alert, status_code=201)
async def post_alert(data: AlertIn, u: dict = Depends(need("duty"))) -> Alert:
    """Событие напрямую (без звука): от внешнего детектора или для проверки."""
    try:
        a = world.add_alert(data)
    except KeyError:
        raise HTTPException(404, f"Неизвестный буй: {data.buoy_id}")
    accounts.record(u["name"], "alert.add", a.id, kind=a.kind, buoy=a.buoy_name)
    await publish()
    return a


@app.patch("/api/alerts/{alert_id}", response_model=Alert)
async def patch_alert(alert_id: str, body: AlertPatch, u: dict = Depends(need("duty"))) -> Alert:
    before = next((x.status for x in world.alerts if x.id == alert_id), None)
    try:
        a = world.patch_alert(alert_id, body.status, u["name"], body.verdict)
    except KeyError:
        raise HTTPException(404, f"Нет алерта {alert_id}")
    # кто и когда решил — в журнал действий (хэш-цепочка): «закрыл как ложную» потом не оспорить
    accounts.record(u["name"], "alert.status", alert_id, before=before, after=body.status, kind=a.kind, buoy=a.buoy_name)
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
    """Проверка цепочки SHA-256 и звуковых улик, а также журнала действий: цела ли доказательная база."""
    c = world.verify_chain()
    n, broken = accounts.verify()
    c.journal_checked, c.journal_head = n, accounts.head()
    if broken and c.ok:
        c.ok, c.broken_at, c.reason = False, f"журнал #{broken}", "запись журнала действий изменена"
    # каждая прежняя печать должна найтись в нынешних цепочках: иначе прошлое переписали
    hashes = {a.hash for a in world.alerts} | {"0" * 64}
    jhashes = {e["hash"] for e in accounts.journal(1000)} | {"0" * 64}
    for a in accounts.anchors():
        c.anchors_checked += 1
        if c.ok and (a["alerts_head"] not in hashes or a["journal_head"] not in jhashes):
            c.ok, c.broken_at, c.reason = False, f"печать {a['ts'][:16]}", "цепочка не совпадает с поставленной ранее печатью — прошлое переписано"
    return c


@app.get("/api/evidence/seal")
def get_seal(_: dict = Depends(need("duty"))) -> dict:
    """Последние печати цепочки (новые сверху) — их сохраняют вне сервера."""
    return {"anchors": list(reversed(accounts.anchors()))[:30], "webhook": bool(ANCHOR_WEBHOOK)}


@app.post("/api/evidence/seal")
def post_seal(u: dict = Depends(need("duty"))) -> dict:
    return seal_now(u["name"])


# ---------- вход, люди, журнал действий ----------
class LoginIn(BaseModel):
    login: str = Field(max_length=40)
    password: str = Field(max_length=200)


class UserIn(BaseModel):
    login: str = Field(max_length=40)
    name: str = Field(default="", max_length=80)
    role: Literal["observer", "duty", "senior"] = "duty"


class UserPatch(BaseModel):
    role: Literal["observer", "duty", "senior"] | None = None
    disabled: bool | None = None
    reset_password: bool = False


@app.post("/api/auth/login")
def auth_login(body: LoginIn, request: Request, response: Response) -> dict:
    ip, login = client_ip(request), body.login.strip().lower()
    if not login_ip.allow(ip) or login_fail.blocked(login):
        raise HTTPException(429, "Слишком много попыток — подождите несколько минут")
    sid = accounts.login(login, body.password)
    if not sid:
        login_fail.allow(login)
        accounts.record(login or "?", "auth.fail", login, ip=ip)
        raise HTTPException(401, "Неверный логин или пароль")
    login_fail.reset(login)
    u = accounts.session_user(sid)
    accounts.record(u["name"], "auth.login", login, ip=ip)
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").startswith("https")
    response.headers["set-cookie"] = security.session_cookie(sid, https, SESSION_DAYS)
    return {"login": u["login"], "name": u["name"], "role": u["role"]}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response) -> dict:
    sid = request.cookies.get(security.SESSION)
    u = accounts.session_user(sid)
    accounts.logout(sid)
    if u:
        accounts.record(u["name"], "auth.logout", u["login"])
    response.headers["set-cookie"] = f"{security.SESSION}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
    return {"ok": True}


@app.get("/api/auth/me")
def auth_me(request: Request) -> dict:
    u = user_of(request)
    return {**u, "role_title": ROLE_TITLE[u["role"]], "accounts": accounts.enabled()}


@app.get("/api/users")
def users_list(_: dict = Depends(need("senior"))) -> list[dict]:
    return accounts.users()


@app.post("/api/users", status_code=201)
def users_add(body: UserIn, u: dict = Depends(need("senior"))) -> dict:
    try:
        pw = accounts.add(body.login, body.role, body.name)
    except ValueError as e:
        raise HTTPException(422, str(e))
    accounts.record(u["name"], "user.add", body.login.strip().lower(), role=body.role)
    return {"login": body.login.strip().lower(), "password": pw}


@app.patch("/api/users/{login}")
def users_patch(login: str, body: UserPatch, u: dict = Depends(need("senior"))) -> dict:
    if u.get("login") == login and (body.disabled or (body.role and body.role != "senior")):
        raise HTTPException(422, "Себя отключить или понизить нельзя — попросите другого старшего")
    try:
        pw = accounts.update(login, role=body.role, disabled=body.disabled, reset=body.reset_password)
    except KeyError:
        raise HTTPException(404, "Нет такого человека")
    except ValueError as e:
        raise HTTPException(422, str(e))
    accounts.record(u["name"], "user.update", login, role=body.role, disabled=body.disabled, reset=body.reset_password)
    return {"login": login, "password": pw}


@app.get("/api/journal")
def journal(limit: int = 100, _: dict = Depends(need("duty"))) -> list[dict]:
    """Журнал действий: кто и что сделал, новые сверху. Каждая запись сцеплена с предыдущей SHA-256."""
    return accounts.journal(limit)


# ---------- демо ----------
@app.post("/api/demo/run")
async def demo_run(calm_s: float = 4, warn_s: float = 8, u: dict = Depends(need("duty"))) -> dict:
    if not DEMO:
        raise HTTPException(403, "Демо выключено на этом сервере (DEMO=0)")
    sim.start_demo(max(0.5, min(calm_s, 60)), max(0.5, min(warn_s, 120)))
    accounts.record(u["name"], "demo.run")
    return {"started": True}


@app.post("/api/demo/reset")
async def demo_reset(u: dict = Depends(need("duty"))) -> dict:
    # сброс стирает базу и звуковые улики — на настоящих данных недоступен
    if not DEMO:
        raise HTTPException(403, "Демо выключено на этом сервере (DEMO=0)")
    sim.stop_demo()
    world.reset()
    accounts.clear_anchors()
    accounts.record(u["name"], "demo.reset")
    await publish()
    return {"reset": True}


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    # только со своего сайта (чужая страница не откроет соединение с cookie дежурного) и не больше MAX_WS_CLIENTS
    if not security.origin_allowed(socket.headers.get("origin"), socket.headers.get("host")) or len(clients) >= MAX_WS_CLIENTS:
        await socket.close(code=1008)
        return
    await socket.accept()
    clients.add(socket)
    try:
        await socket.send_text(world.state().model_dump_json())
        while True:
            msg = await socket.receive_text()  # клиент молчит; держим соединение
            if len(msg) > 1024:
                break
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(socket)


# Собранный фронтенд (web/dist) отдаётся тем же сервером — один процесс для деплоя
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
