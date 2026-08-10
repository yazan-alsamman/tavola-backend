#!/usr/bin/env bash
# Quick health snapshot for the tavola-backend stack. Read-only - safe to
# run any time, changes nothing.
set -euo pipefail

echo "== Containers =="
docker ps -a --filter "name=tavla-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo
echo "== Health endpoints =="
for path in health health/readiness health/liveness; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/api/v1/$path" || echo ERR)"
  echo "  /api/v1/$path -> $code"
done

echo
echo "== Postgres =="
docker exec tavla-postgres-1 pg_isready -U tavla -d tavla_prod 2>&1 || echo "  postgres unreachable"

echo
echo "== Redis =="
docker exec tavla-redis-1 sh -c 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping' 2>&1 || echo "  redis unreachable"

echo
echo "== MinIO =="
curl -s -o /dev/null -w "  /minio/health/live -> %{http_code}\n" http://127.0.0.1:9000/minio/health/live

echo
echo "== Recent backend errors (last 200 log lines) =="
docker logs tavla-backend-1 --tail 200 2>&1 | grep -i '"level":5[0-9]' || echo "  none found"

echo
echo "== Disk usage =="
df -h / | tail -1

echo
echo "== Memory usage =="
free -h | head -2

echo
echo "== Docker disk usage =="
docker system df
