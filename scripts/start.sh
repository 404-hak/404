#!/usr/bin/env bash
# Один процесс, как на защите: собирает дашборд и запускает API, который его раздаёт.
# Открыть: http://localhost:8000 (в Codespaces — вкладка «Порты», порт 8000)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x api/.venv/bin/uvicorn ] && [ -d web/node_modules ] || bash .devcontainer/setup.sh
if [ -n "${VITE_YANDEX_MAPS_KEY:-}" ]; then echo "Яндекс Карты: ключ найден"; else echo "Яндекс Карты: ключа нет — будет офлайн-схема"; fi
(cd web && npm run build)
# Codespaces уже мог запустить дашборд при открытии — останавливаем старый, чтобы не было «address already in use»
if pkill -f "uvicorn app.main:app" 2>/dev/null; then echo "Остановлен предыдущий запуск дашборда"; sleep 1; fi
echo "Дашборд: порт ${PORT:-8000} (в Codespaces — вкладка «Порты»). Обновите страницу в браузере: Ctrl+Shift+R"
cd api && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
