#!/usr/bin/env bash
set -euo pipefail

# scripts/backup-db.sh
# Generates a timestamped PostgreSQL dump of the research database.

BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/gdss_backup_${TIMESTAMP}.sql"

POSTGRES_USER="${POSTGRES_USER:-gdss_user}"
POSTGRES_DB="${POSTGRES_DB:-gdss_db}"

echo "[backup] Creating database dump to ${BACKUP_FILE}..."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$BACKUP_FILE"

echo "[backup] Successfully generated ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"
