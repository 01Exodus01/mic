#!/usr/bin/env bash
set -euo pipefail

# scripts/restore-db.sh
# Restores a PostgreSQL dump to the database container.

if [ $# -lt 1 ]; then
  echo "Uso: $0 <archivo_de_respaldo.sql>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: el archivo '$BACKUP_FILE' no existe."
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-gdss_user}"
POSTGRES_DB="${POSTGRES_DB:-gdss_db}"

echo "[restore] Restoring database from ${BACKUP_FILE}..."
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$BACKUP_FILE"

echo "[restore] Database restore completed successfully."
