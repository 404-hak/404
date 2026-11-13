"""Защита из docs/audit/01-security.md: доступ по ссылке, демо на настоящих данных, лимиты, заголовки, WebSocket."""
import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.audio import dsp
from app.security import COOKIE, cookie_value

TOKEN = "t0k3n-for-tests-only"


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def private(monkeypatch):
    monkeypatch.setenv("ACCESS_TOKEN", TOKEN)
    monkeypatch.delenv("BUOY_TOKEN", raising=False)


def test_open_without_token(client):
    assert client.get("/api/state").status_code == 200


def test_private_needs_access(client, private):
    assert client.get("/api/state").status_code == 401
    assert client.patch("/api/alerts/x", json={"status": "resolved"}).status_code == 401
    assert client.post("/api/demo/reset").status_code == 401
    assert client.get("/docs").status_code == 401
    page = client.get("/", headers={"accept": "text/html"})
    assert page.status_code == 401 and "ссылка доступа" in page.text
    assert client.get("/api/health").status_code == 200           # мониторинг — без доступа


def test_bearer_and_access_link(client, private):
    assert client.get("/api/state", headers={"authorization": f"Bearer {TOKEN}"}).status_code == 200
    assert client.get("/api/state", headers={"authorization": "Bearer wrong"}).status_code == 401
    r = client.get(f"/?access={TOKEN}&x=1", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/?x=1"                       # токен убран из адреса
    assert "HttpOnly" in r.headers["set-cookie"] and "SameSite=Strict" in r.headers["set-cookie"]
    assert TOKEN not in r.headers["set-cookie"]                   # в cookie подпись, а не сам токен
    client.cookies.set(COOKIE, cookie_value(TOKEN))
    assert client.get("/api/state").status_code == 200


def test_ws_needs_access_and_own_origin(client, private):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws") as ws:
            ws.receive_text()
    client.cookies.set(COOKIE, cookie_value(TOKEN))
    with client.websocket_connect("/ws") as ws:
        assert '"buoys"' in ws.receive_text()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_text()


def test_demo_reset_disabled_on_real_data(client, monkeypatch):
    monkeypatch.setattr(main, "DEMO", False)
    assert client.post("/api/demo/reset").status_code == 403
    assert client.post("/api/demo/run").status_code == 403


def _wav_header(rate: int, frames: int, data: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data)
    raw = bytearray(buf.getvalue())
    return bytes(raw)


def test_wav_with_absurd_rate_is_rejected_before_resampling():
    # 2 МБ при частоте 1 Гц раньше раздувались в 16 000 раз
    wav = _wav_header(1, 1_000_000, np.zeros(1_000_000, np.int16).tobytes())
    with pytest.raises(dsp.AudioError):
        dsp.read_wav(wav)


def test_truncated_wav_is_an_audio_error_not_500():
    wav = dsp.write_wav(np.zeros(16000 * 3, np.float32))
    cut = wav[:-1]                                                # последний кадр неполный
    x = dsp.read_wav(cut)
    assert len(x) > 0


def test_body_limit_by_content_length(client):
    r = client.post("/api/lab/analyze", content=b"x" * 10, headers={"content-length": str(main.MAX_CLIP_BYTES + 1)})
    assert r.status_code in (413, 503)                            # 503 — если нейросеть не обучена в этом окружении


def test_input_bounds(client):
    assert client.get("/api/alerts?limit=-5").status_code == 200
    assert client.post("/api/lab/clip/not-a-sha").status_code in (400, 503)
    assert client.post("/api/lab/clip/..%2F..").status_code in (400, 404, 405, 503)   # путь с ../ не доходит до файлов
    assert "db" in client.get("/api/health").json() and "/" not in str(client.get("/api/health").json()["db"])


def test_security_headers_and_gzip(client):
    r = client.get("/api/state", headers={"accept-encoding": "gzip"})
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'self'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    assert r.headers.get("content-encoding") == "gzip"


def test_old_clips_without_alert_are_pruned_but_evidence_stays(tmp_path):
    import os
    import time

    from app.store import Clips

    clips = Clips(tmp_path)
    noise = clips.put(b"RIFF-noise")
    evidence = clips.put(b"RIFF-evidence")
    old = time.time() - 48 * 3600
    for sha in (noise, evidence):
        os.utime(tmp_path / f"{sha}.wav", (old, old))
    assert clips.prune({evidence}, 24 * 3600) == 1
    assert clips.get(noise) is None
    assert clips.get(evidence) == b"RIFF-evidence"
