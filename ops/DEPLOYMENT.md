# Tavola Backend — Production Deployment (srv1614440)

This VPS also hosts two unrelated PM2-managed apps (`eliasdahdal.clinic` on port
5000, `vegacore.co` on port 3001) fronted by the system Nginx on 80/443, plus a
standalone MongoDB. **None of this deployment touches those** — everything
below is isolated under Docker, prefixed `tavla`.

---

## 1. Project location

- Repo: `/opt/tavola-backend` (clone of `github.com/yazan-alsamman/tavola-backend`, branch `main`)
- Backend app: `/opt/tavola-backend/apps/backend`
- Docker configs: `/opt/tavola-backend/apps/backend/docker/`
- Production secrets: `/opt/tavola-backend/apps/backend/.env.production` (root-only, `chmod 600`, **not** in git — `.gitignore` excludes all `.env*`)
- Ops scripts: `/opt/tavola-backend/ops/` (`deploy.sh`, `rollback.sh`, `backup.sh`, `status.sh`, this file)
- Backups: `/opt/tavola-backend/backups/` (gitignored)
- Generated secrets record: `/root/.secrets/tavola-secrets.env` (root-only, `chmod 600` — same values as embedded in `.env.production`; kept separately as the source of truth in case `.env.production` is ever regenerated)

## 2. Docker architecture

Compose project name: `tavla`. Files layered: the repo's own
`apps/backend/docker/docker-compose.yml` (production-shaped, upstream) plus
`docker-compose.prod.yml` (server-local, **not committed**, untracked +
gitignored) which adds host port bindings and a couple of env vars the
upstream compose file doesn't pass through to the `backend` container
(`SWAGGER_ENABLED`, `MINIO_REGION`, rate-limit overrides, etc. — see that
file's header comment for the full list and why).

The upstream `nginx` container defined in `docker-compose.yml` is **deliberately
never started** — this host already has its own system Nginx in front of the
other two sites, and there is no point running two reverse proxies. It's
omitted by never including `nginx` in the service list passed to `up -d`, not
by editing the compose file.

```
┌─────────────────────────────────────────────────────────┐
│  Docker network: tavla_tavla-network (isolated, bridge)  │
│                                                           │
│   postgres:17-alpine ──┐                                 │
│   redis:7-alpine ──────┼──── backend (NestJS, node:24)   │
│   minio/minio:latest ──┘        ↑                        │
│                                  │                        │
└──────────────────────────────────┼────────────────────────┘
                                    │ 0.0.0.0:3000
                          (public, plain HTTP — no domain yet)
```

Named volumes (persist across container recreation):
`tavla_postgres-data`, `tavla_redis-data`, `tavla_minio-data`.

## 3. Running containers & ports

| Container            | Image                | Host binding              | Notes |
|-----------------------|-----------------------|----------------------------|-------|
| `tavla-backend-1`    | `tavla-backend:latest`| `0.0.0.0:3000` → `3000`   | Public HTTP API. No TLS yet (no domain). |
| `tavla-postgres-1`   | `postgres:17-alpine`  | `127.0.0.1:5432` → `5432` | Loopback only — reachable from the host (for migrations) but not the internet. |
| `tavla-redis-1`      | `redis:7-alpine`      | *(none)*                   | Internal-only, password-protected. |
| `tavla-minio-1`      | `minio/minio:latest`  | `0.0.0.0:9000` → `9000` (S3 API), `127.0.0.1:9001` → `9001` (console) | S3 API public (presigned URLs need it); admin console loopback-only — `ssh -L 9001:localhost:9001 root@187.127.76.76` to reach it. |
| `tavla-minio-init-1` | `minio/mc:latest`     | *(none)*                   | One-shot bucket creator, exits after running — expected, not a crash. |

Firewall (`ufw`): opened `3000/tcp` and `9000/tcp` alongside the pre-existing
`22`, `80,443`, `8080` rules. Nothing removed.

## 4. Environment variables

Full reference: the repo's own `docs/ENVIRONMENT_SETUP.md` and
`apps/backend/src/config/env.validation.ts`. Names only (values live in
`.env.production` and `/root/.secrets/tavola-secrets.env`):

- **App**: `NODE_ENV`, `PORT`, `API_VERSION`, `CORS_ALLOWED_ORIGINS`, `SWAGGER_ENABLED`, `REQUEST_BODY_LIMIT`, `LOG_LEVEL`, `LOG_PRETTY`, `CORRELATION_ID_HEADER`
- **Database**: `DATABASE_URL`, `DATABASE_POOL_MODE`, `DATABASE_MAX_CONNECTIONS`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- **Redis**: `REDIS_URL`, `REDIS_PASSWORD`, `REDIS_CACHE_DB_INDEX`, `REDIS_QUEUE_DB_INDEX`, `REDIS_SOCKET_ADAPTER_DB_INDEX`
- **MinIO**: `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_REGION`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_PUBLIC_PORT`, `MINIO_PUBLIC_USE_SSL`, `MINIO_PUBLIC_BUCKET`, `MINIO_PRIVATE_BUCKET`, `MINIO_SIGNED_URL_EXPIRY_SECONDS`
- **Auth**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`, `REFRESH_CONCURRENT_GRACE_MS`
- **Rate limiting**: `RATE_LIMIT_*` (login/refresh/forgot-password/reset-password/register/change-password × max/window) — all currently at the codebase's own defaults

**Known placeholders you'll want to change:**
- `CORS_ALLOWED_ORIGINS=http://localhost:3000` — update to the real frontend URL(s) once known (comma-separated), then `docker compose ... up -d backend` to apply.
- `MINIO_PUBLIC_ENDPOINT=187.127.76.76`, `MINIO_PUBLIC_USE_SSL=false` — update once a domain fronts MinIO.

## 5. No domain yet — current access is plain HTTP over the VPS IP

Frontend devs can hit the API directly right now:
- API: `http://187.127.76.76:3000/api/v1/...`
- Swagger docs: `http://187.127.76.76:3000/api/v1/docs`
- File uploads (presigned URLs): signed against `http://187.127.76.76:9000/...`

This is **temporary and unencrypted** — fine to start integration, not fine to
stay on long-term (credentials/tokens travel in plaintext). Once a domain's
DNS A record points at `187.127.76.76`:

1. Add an Nginx vhost (new file in `/etc/nginx/sites-available/`, e.g.
   `tavola-api` — never edit `clinic` or `vegacore-website.conf`) proxying to
   `127.0.0.1:3000` (same pattern as the two existing sites).
2. `certbot --nginx -d api.yourdomain.com` to get a Let's Encrypt cert (auto-renewal is already active on this host — see `systemctl list-timers | grep certbot`).
3. Change `docker-compose.prod.yml`'s `backend.ports` from `0.0.0.0:3000:3000` to `127.0.0.1:3000:3000` (API becomes reachable only through Nginx/TLS, not directly).
4. Update `CORS_ALLOWED_ORIGINS` and `MINIO_PUBLIC_*` in `.env.production` accordingly.
5. Decide whether MinIO also needs a domain-fronted path (e.g. `files.yourdomain.com` proxying to `127.0.0.1:9000`) so uploads/downloads are also encrypted — recommended before going fully live.

## 6. Update process (day-to-day deploys)

```bash
/opt/tavola-backend/ops/deploy.sh          # deploys latest commit on main
/opt/tavola-backend/ops/deploy.sh <branch> # deploys a specific branch instead
```

What it does, in order: `git fetch` + hard-reset to the branch tip → `pnpm
install` → build the Docker image (tags it both `:latest` and `:<short-sha>`)
→ ensure Postgres/Redis/MinIO are healthy → `prisma migrate deploy` → `prisma
db seed` (idempotent, safe every time) → recreate the `backend` container →
wait for its healthcheck → verify `/api/v1/health/readiness` → prune old
images (keeps the last 5 commit-tagged images). Aborts on the first failure
(`set -euo pipefail`) rather than leaving things half-applied.

This is a brief-restart deploy (the `backend` container is recreated), not
truly zero-downtime — there's a single backend instance, so a few hundred ms
of unavailability during container swap is expected. True zero-downtime would
need ≥2 backend replicas behind a load balancer, which isn't warranted at
current scale; revisit if/when traffic justifies it.

## 7. Rollback procedure

```bash
docker images tavla-backend        # list available commit-tagged images (last 5 kept)
/opt/tavola-backend/ops/rollback.sh <short-sha>
```

Retags that image as `:latest` and recreates the `backend` container — no
rebuild, fast. **Caveat**: Prisma migrations are forward-only. Rolling back
code past a commit that added a database migration does *not* undo that
migration. This is usually harmless (old code simply ignores new
columns/tables) but can break if a migration altered or dropped something the
older code still expects — in that case, restore from a Postgres backup
instead (§9) rather than rolling back code alone.

## 8. Backup procedure

```bash
/opt/tavola-backend/ops/backup.sh
```

Dumps Postgres (`pg_dump | gzip`) and archives the entire MinIO data volume to
`/opt/tavola-backend/backups/`, keeping the last 14 of each. Already
scheduled via root's crontab, daily at 03:15 server time:

```
15 3 * * * /opt/tavola-backend/ops/backup.sh >> /var/log/tavola-backup.log 2>&1
```

Consider also copying `backups/` off-box periodically (e.g. `rsync` to
another host or object storage) — right now backups live on the same disk as
the data they protect, which doesn't survive a full disk/VPS loss.

## 9. Restore procedure

**Postgres** (destructive — overwrites current data, confirm you want this first):
```bash
cd /opt/tavola-backend/apps/backend/docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production stop backend
gunzip -c /opt/tavola-backend/backups/postgres_<timestamp>.sql.gz | docker exec -i tavla-postgres-1 psql -U tavla -d tavla_prod
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production start backend
```

**MinIO data**:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production stop minio
docker run --rm -v tavla_minio-data:/data -v /opt/tavola-backend/backups:/backup alpine:3 \
  sh -c "rm -rf /data/* && tar xzf /backup/minio_<timestamp>.tar.gz -C /data"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production start minio
```

## 10. Health monitoring

```bash
/opt/tavola-backend/ops/status.sh
```

Prints container status, all four health endpoints, Postgres/Redis/MinIO
liveness, recent error-level backend logs, disk/memory usage, and Docker's
own disk usage. Useful one-liners:

```bash
docker logs -f tavla-backend-1          # live tail
docker logs --since 1h tavla-backend-1  # last hour
docker stats --no-stream                # resource usage snapshot
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file ../.env.production ps   # (run from apps/backend/docker/)
```

## 11. Troubleshooting

- **`docker inspect ... State.Health.Status` stuck on `starting`**: check
  `docker logs <container>` — most often a bad env var or the DB not being
  reachable yet. `postgres`/`redis`/`minio` all have generous
  `start_period`s; `backend` waits on all three via `depends_on: condition:
  service_healthy` before it even starts.
- **Prisma `P1000: Authentication failed`**: almost always means
  `POSTGRES_PASSWORD` in `.env.production` was changed after the `postgres`
  container already initialized its data directory (Postgres only applies
  `POSTGRES_USER`/`PASSWORD`/`DB` on first init). See
  `docs/ENVIRONMENT_SETUP.md`'s "Recovering From Local Docker Credential/Volume
  Drift" section — the same fix applies, but treat `docker volume rm
  tavla_postgres-data` as **destructive and irreversible**; never run it
  against this production volume without a fresh backup confirmed restorable
  first.
- **Migrations don't apply from inside the `backend` container**: expected —
  the production runtime image deliberately excludes the Prisma CLI and all
  devDependencies. Migrations only ever run from the host, which is what
  `deploy.sh` already does.
- **Swagger 404s**: confirm `SWAGGER_ENABLED=true` actually reached the
  container (`docker exec tavla-backend-1 printenv | grep SWAGGER`) — the
  upstream `docker-compose.yml` doesn't pass this through on its own;
  `docker-compose.prod.yml` adds it. If you ever stop using
  `docker-compose.prod.yml`, this (and several rate-limit/JWT-issuer vars)
  silently reverts to defaults.
- **Port already in use** when starting a container: check `ss -tlnp` first —
  this host also runs PM2 apps on 5000/3001 and MongoDB on 27017; nothing here
  should collide, but if it ever does, fix the port mapping in
  `docker-compose.prod.yml`, never by touching the other apps.
