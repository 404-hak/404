# Правила для Claude в этом репозитории

- Работать прямо в `main`: коммитить и пушить в `main`, без отдельных веток и pull request'ов.
- Перед пушем: `cd web && npx tsc --noEmit && npm run build`, тесты API: `cd api && .venv/bin/python -m pytest -q`.
- Codespace собирает дашборд при открытии, поэтому после пуша изменения видны только после `git pull` и `bash scripts/start.sh` в codespace и обновления страницы (Ctrl+Shift+R).
