#!/usr/bin/env bash
# Разработка с горячей перезагрузкой: API на :8000 и Vite на :5173 (открывать :5173)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x api/.venv/bin/uvicorn ] && [ -d web/node_modules ] || bash .devcontainer/setup.sh
(cd api && exec .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
cd web && npm run dev -- --host 0.0.0.0
