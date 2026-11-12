#!/usr/bin/env bash
# Установка зависимостей API и дашборда (Codespaces вызывает это один раз при создании)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x api/.venv/bin/python ] || python3 -m venv api/.venv
api/.venv/bin/pip install -q --upgrade pip
api/.venv/bin/pip install -q -r api/requirements-dev.txt
(cd web && npm ci --no-audit --no-fund)
echo "Готово. Дашборд: bash scripts/start.sh  ·  разработка: bash scripts/dev.sh"
