#!/usr/bin/env bash
# Redeploys tavola-backend from the latest commit on the tracked branch.
# Safe to re-run any time - every step is idempotent. Must run as root on
# srv1614440 (this VPS also hosts eliasdahdal.clinic and vegacore.co via
# PM2 + system Nginx; this script only ever touches Docker resources
# prefixed "tavla" and never restarts nginx or system services).
#
# Usage: /opt/tavola-backend/ops/deploy.sh [branch]   (default: main)

set -euo pipefail

REPO_DIR="/opt/tavola-backend"
BACKEND_DIR="$REPO_DIR/apps/backend"
DOCKER_DIR="$BACKEND_DIR/docker"
ENV_FILE="$BACKEND_DIR/.env.production"
BRANCH="${1:-main}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production"
INFRA_SERVICES="postgres redis minio minio-init"

log() { printf '\n\033[1;34m[deploy]\033[0m %s\n' "$1"; }
fail() { printf '\n\033[1;31m[deploy FAILED]\033[0m %s\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found - was the server ever set up?"

log "Fetching latest code (branch: $BRANCH)"
cd "$REPO_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
COMMIT="$(git rev-parse --short HEAD)"
log "Now at commit $COMMIT"

log "Installing workspace dependencies (pnpm install --frozen-lockfile)"
pnpm install --frozen-lockfile

log "Building backend Docker image"
cd "$DOCKER_DIR"
$COMPOSE build backend
docker tag tavla-backend:latest "tavla-backend:$COMMIT"
log "Tagged image as tavla-backend:$COMMIT (kept alongside :latest for rollback.sh)"

log "Ensuring infra services (postgres, redis, minio) are up and healthy"
$COMPOSE up -d $INFRA_SERVICES

for svc in postgres redis minio; do
  for i in $(seq 1 30); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "tavla-${svc}-1" 2>/dev/null || echo missing)"
    [ "$status" = "healthy" ] && break
    sleep 2
    [ "$i" -eq 30 ] && fail "$svc did not become healthy in time"
  done
done
log "Infra services healthy"

log "Applying Prisma migrations"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
cd "$BACKEND_DIR"
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?schema=public"
export DATABASE_URL

log "Regenerating Prisma Client (host node_modules must match the schema just pulled)"
pnpm prisma:generate

pnpm prisma:migrate:deploy

log "Running seed (idempotent - safe on every deploy)"
pnpm prisma:seed

log "Recreating backend container with the new image"
cd "$DOCKER_DIR"
$COMPOSE up -d backend

log "Waiting for backend health check"
for i in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' tavla-backend-1 2>/dev/null || echo missing)"
  [ "$status" = "healthy" ] && break
  sleep 2
  [ "$i" -eq 30 ] && fail "backend did not become healthy after deploy - check: docker logs tavla-backend-1"
done

log "Verifying readiness endpoint"
READY="$(curl -sf http://127.0.0.1:3000/api/v1/health/readiness)" || fail "readiness check failed"
echo "$READY"
case "$READY" in
  *'"status":"ok"'*) ;;
  *) fail "readiness endpoint did not report ok" ;;
esac

log "Pruning unused Docker images (keeping the last 5 tavla-backend:<sha> tags for rollback)"
docker images "tavla-backend" --format '{{.Tag}} {{.CreatedAt}}' \
  | grep -v '^latest ' \
  | sort -k2 -r \
  | tail -n +6 \
  | awk '{print $1}' \
  | xargs -r -I{} docker rmi "tavla-backend:{}" 2>/dev/null || true
docker image prune -f >/dev/null

log "Deploy of commit $COMMIT succeeded."
