#!/usr/bin/env bash
# Один процесс, как на защите: собирает дашборд и запускает API, который его раздаёт.
# Открыть: http://localhost:8000 (в Codespaces — вкладка «Порты», порт 8000)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x api/.venv/bin/uvicorn ] && [ -d web/node_modules ] || bash .devcontainer/setup.sh
if [ -n "${VITE_YANDEX_MAPS_KEY:-}" ]; then echo "Яндекс Карты: ключ найден"; else echo "Яндекс Карты: ключа нет — будет офлайн-схема"; fi
(cd web && npm run build)
cd api && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
