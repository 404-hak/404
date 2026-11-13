#!/usr/bin/env bash
# Ежедневная копия базы и звука улик (cron: 15 3 * * * /path/deploy/backup.sh /backups)
set -euo pipefail
cd "$(dirname "$0")"
DEST="${1:-./backups}"; STAMP=$(date +%F)
mkdir -p "$DEST"
docker compose exec -T app python -c "import sqlite3; s=sqlite3.connect('/data/404.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d); d.close()"
docker compose cp app:/data/backup.db "$DEST/404-$STAMP.db"
docker compose exec -T app tar -C /data -czf - clips > "$DEST/clips-$STAMP.tgz"
find "$DEST" -name '404-*.db' -mtime +30 -delete; find "$DEST" -name 'clips-*.tgz' -mtime +30 -delete
echo "Копия: $DEST (база и клипы, хранятся 30 дней)"
