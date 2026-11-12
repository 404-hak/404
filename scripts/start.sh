#!/usr/bin/env bash
# Один процесс, как на защите: собирает дашборд и запускает API, который его раздаёт.
# Открыть: http://localhost:8000 (в Codespaces — вкладка «Порты», порт 8000)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x api/.venv/bin/uvicorn ] && [ -d web/node_modules ] || bash .devcontainer/setup.sh
if [ -n "${VITE_YANDEX_MAPS_KEY:-}" ]; then echo "Яндекс Карты: ключ найден"; else echo "Яндекс Карты: ключа нет — будет офлайн-схема"; fi
# после git pull могли добавиться зависимости (three.js для 3D-карты, numpy для нейросети) — доустанавливаем
if [ ! web/node_modules/.package-lock.json -nt web/package-lock.json ]; then (cd web && npm ci --no-audit --no-fund); fi
REQ_HASH=$(cat api/requirements.txt api/requirements-dev.txt | sha256sum | cut -c1-16)
if [ "$(cat api/.venv/.req-hash 2>/dev/null)" != "$REQ_HASH" ]; then
  api/.venv/bin/pip install -q -r api/requirements-dev.txt && echo "$REQ_HASH" > api/.venv/.req-hash
fi
(cd web && npm run build)
# Codespaces уже мог запустить дашборд при открытии — останавливаем старый, чтобы не было «address already in use»
if pkill -f "uvicorn app.main:app" 2>/dev/null; then echo "Остановлен предыдущий запуск дашборда"; sleep 1; fi
echo "Дашборд: порт ${PORT:-8000} (в Codespaces — вкладка «Порты»). Обновите страницу в браузере: Ctrl+Shift+R"
cd api && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
