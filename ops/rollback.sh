#!/usr/bin/env bash
# Rolls the backend container back to a previously deployed image, without
# rebuilding. deploy.sh tags every build as tavla-backend:<short-sha> (kept
# for the last 5 deploys) in addition to :latest - use `docker images
# tavla-backend` to list what's available.
#
# IMPORTANT: this only rolls back the running code/image. Prisma migrations
# are forward-only - if the commit you're rolling back past added a
# database migration, the schema will NOT be rolled back automatically.
# Rolling back application code against a newer schema is usually safe
# (new nullable columns/tables are simply unused by older code), but a
# migration that altered/removed a column the old code depends on will
# break it. When in doubt, restore the matching Postgres backup instead
# (see DEPLOYMENT.md's Restore Procedure) rather than just rolling back code.
#
# Usage: /opt/tavola-backend/ops/rollback.sh <short-sha>
#        docker images tavla-backend   # to see what's available

set -euo pipefail

DOCKER_DIR="/opt/tavola-backend/apps/backend/docker"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production"

log() { printf '\n\033[1;34m[rollback]\033[0m %s\n' "$1"; }
fail() { printf '\n\033[1;31m[rollback FAILED]\033[0m %s\n' "$1" >&2; exit 1; }

SHA="${1:-}"
[ -n "$SHA" ] || fail "Usage: rollback.sh <short-sha> (see: docker images tavla-backend)"
docker image inspect "tavla-backend:$SHA" >/dev/null 2>&1 || fail "No local image tavla-backend:$SHA - it may have been pruned. Check: docker images tavla-backend"

log "Retagging tavla-backend:$SHA as :latest"
docker tag "tavla-backend:$SHA" tavla-backend:latest

cd "$DOCKER_DIR"
log "Recreating backend container"
$COMPOSE up -d backend

log "Waiting for backend health check"
for i in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' tavla-backend-1 2>/dev/null || echo missing)"
  [ "$status" = "healthy" ] && break
  sleep 2
  [ "$i" -eq 30 ] && fail "backend did not become healthy - check: docker logs tavla-backend-1"
done

curl -sf http://127.0.0.1:3000/api/v1/health/readiness || fail "readiness check failed"
log "Rolled back to tavla-backend:$SHA successfully."
