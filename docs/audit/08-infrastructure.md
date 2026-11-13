# Инфраструктура, CI, приложение iOS

Статус: ✅ · 🟡 · ⏳.

## Находки

| ID | Уровень | Что | Статус |
|----|---------|-----|--------|
| I1 | P0 | **Нет схемы боевого развёртывания:** нет Dockerfile, обратного прокси с HTTPS, менеджера процессов. Сейчас сайт живёт в Codespaces (публичный порт) или вручную. | ⏳ `Dockerfile` (сборка сайта + API), `Caddyfile` (HTTPS автоматически), `compose.yml`; как на прошлом сайте команды (`deploy/Caddyfile`) |
| I2 | P1 | CI собирал только `.ipa`; тесты и сборка сайта не проверялись. | ✅ `.github/workflows/ci.yml`: pytest, `pip-audit`, `npm ci` + проверка типов + сборка, `npm audit --omit=dev` |
| I3 | P1 | Нет резервных копий `api/data` (база + звук улик) и мониторинга. | ⏳ ежедневная копия `sqlite3 .backup` + `clips/` во внешнее хранилище; проверка `/api/health` (он открыт без токена) раз в минуту |
| I4 | P1 | Codespaces: порт 8000 часто делают публичным, чтобы открыть с телефона. Без `ACCESS_TOKEN` это открывает пульт всем, у кого ссылка. | 🟡 `ACCESS_TOKEN` ✅; ⏳ держать порт приватным, на телефон — ссылку доступа |
| I5 | P2 | Порт Vite (5173) в Codespaces: dev-сервер Vite ≤ 6.4.3 позволяет чужим сайтам читать файлы проекта. | ⏳ обновить Vite (мажорная версия — проверить сборку); порт 5173 не делать публичным |
| I6 | P2 | Нет автоматических обновлений зависимостей. | ⏳ Dependabot (`pip`, `npm`, `github-actions`) раз в неделю |
| I7 | P2 | Ротация журналов и сроки хранения. | ⏳ `logrotate` или драйвер журналов Docker с `max-size` |
| I8 | P2 | **iOS:** неподписанный `.ipa` ставится через сторонний установщик — сертификат живёт 7 дней, приложение надо переустанавливать. | ⏳ Apple Developer (99 $/год) → TestFlight; или PWA (манифест уже есть ✅) |
| I9 | P3 | iOS: `NSAllowsArbitraryLoadsInWebContent` разрешает HTTP. | ⏳ в проде только HTTPS |
| I10 | P3 | Действия GitHub закреплены по тегу, `brew install xcodegen` без версии. | ⏳ закрепить по SHA / версии |

## Рекомендуемое развёртывание (пилот)

```
Интернет ──HTTPS──▶ Caddy (автосертификат, сжатие, лимит тела 12 МБ)
                     └──▶ uvicorn app.main:app --ws-max-size 65536 --proxy-headers  (1 процесс)
                            ACCESS_TOKEN=…  BUOY_TOKEN=…  DEMO=0  SIM_HEARTBEAT=0  DATA_DIR=/data
                            /data → том + ежедневная копия
```

Переменные окружения (сводно): `ACCESS_TOKEN`, `BUOY_TOKEN`, `DEMO`, `SIM_HEARTBEAT`, `WEATHER`, `DATA_DIR`, `ALLOWED_ORIGINS`, `MAX_WS_CLIENTS`; при сборке сайта — `VITE_YANDEX_MAPS_KEY` (ограничить по адресу в кабинете Яндекса).

## Codespaces и запуск

- `scripts/start.sh` теперь запускает uvicorn с `--ws-max-size 65536 --proxy-headers` ✅.
- После `git pull` зависимости доустанавливаются сами (хэш `requirements*.txt`) ✅ — обновление FastAPI подтянется при следующем `bash scripts/start.sh`.
