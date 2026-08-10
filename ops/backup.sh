#!/usr/bin/env bash
# Backs up the Postgres database and MinIO object data. Safe, read-only
# against the running stack (pg_dump does not lock out writers). Keeps the
# last 14 daily backups of each kind, deleting older ones.
#
# Usage: /opt/tavola-backend/ops/backup.sh
# Suggested cron (daily at 03:15): 15 3 * * * /opt/tavola-backend/ops/backup.sh >> /var/log/tavola-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="/opt/tavola-backend/backups"
KEEP=14
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Backing up Postgres..."
docker exec tavla-postgres-1 pg_dump -U tavla -d tavla_prod \
  | gzip > "$BACKUP_DIR/postgres_${STAMP}.sql.gz"

echo "[$(date -Is)] Backing up MinIO data volume..."
docker run --rm \
  -v tavla_minio-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine:3 \
  tar czf "/backup/minio_${STAMP}.tar.gz" -C /data .

echo "[$(date -Is)] Pruning backups older than the last $KEEP of each kind..."
ls -1t "$BACKUP_DIR"/postgres_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/minio_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date -Is)] Done: $BACKUP_DIR/postgres_${STAMP}.sql.gz, $BACKUP_DIR/minio_${STAMP}.tar.gz"
