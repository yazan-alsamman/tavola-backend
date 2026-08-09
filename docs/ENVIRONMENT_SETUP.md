# ENVIRONMENT_SETUP.md

# Enterprise Restaurant Reservation Platform

Version: 1.1 — updated after Phase 1.2 (Runtime Infrastructure) implementation and live smoke test.

---

# Purpose

Phase 1 (Infrastructure) requires Docker, Docker Compose, PostgreSQL, Prisma, Redis, BullMQ, and environment configuration, but no prior document specified required environment variables, local setup steps, or the required PostgreSQL extensions. This document is the reference for bringing up the platform in any environment (Development, Testing, Staging, Production) consistently, per NON_FUNCTIONAL_REQUIREMENTS.md's Configuration section ("Configuration must be environment-based... No hardcoded values").

---

# Environments

* **Development** — local Docker Compose stack, seeded data, verbose logging.
* **Testing** — ephemeral containers spun up per CI run (see TESTING_STRATEGY.md), reset between test suites.
* **Staging** — production-equivalent configuration, used for load testing and pre-release verification.
* **Production** — hardened configuration, secrets from a managed secret store (not `.env` files — see Secrets Management below).

Configuration differences between environments are expressed exclusively through environment variables and never through code branches (`if (env === 'production')` business logic is a CODING_STANDARDS.md violation — environment should only affect infrastructure wiring, e.g., which logger transport or which Redis host, never business rules).

---

# Required Environment Variables

## Application

* `NODE_ENV` (`development` | `test` | `staging` | `production`)
* `PORT`
* `API_VERSION` (e.g., `v1`, per API_GUIDELINES.md)
* `CORS_ALLOWED_ORIGINS`
* `NGINX_HOST_PORT` (optional, default `80`) — consumed by the `nginx` container's own port mapping in `docker-compose.yml`, not the NestJS app; only `docker/.env.test` sets it (to `10080`), so the strict-verification stack's reverse proxy doesn't collide with the dev stack's, which keeps the default `80`

## Database

* `DATABASE_URL` (PostgreSQL connection string — inside Docker Compose, host is the `postgres` service name, never `localhost`)
* `DATABASE_POOL_MODE` (`session` | `transaction` — see the PgBouncer note below; must be `transaction` for horizontally-scaled stateless instances per NON_FUNCTIONAL_REQUIREMENTS.md)
* `DATABASE_MAX_CONNECTIONS`
* `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — consumed by the `postgres` container itself (not the NestJS app directly); must stay in sync with the credentials embedded in `DATABASE_URL`

## Redis

* `REDIS_URL` (inside Docker Compose, host is the `redis` service name; embeds the password, e.g. `redis://:password@redis:6379`)
* `REDIS_PASSWORD` — consumed by the `redis` container's `--requirepass` startup flag; must stay in sync with the password embedded in `REDIS_URL`
* `REDIS_MAXMEMORY` — consumed by the `redis` container's `--maxmemory` startup flag (e.g. `256mb`, `512mb`); caps host memory usage since `redis.conf` keeps `maxmemory-policy noeviction` (queue/session data must never be silently evicted, so once the cap is hit writes fail loudly instead)
* `REDIS_CACHE_DB_INDEX` — logical database index used for caching (see ARCHITECTURE.md Database Strategy)
* `REDIS_QUEUE_DB_INDEX` — logical database index used by BullMQ
* `REDIS_SOCKET_ADAPTER_DB_INDEX` — logical database index used by the Socket.IO Redis Adapter (ADR-015), kept separate from cache/queue traffic for observability

## Authentication

* `JWT_ACCESS_SECRET` / `JWT_ACCESS_EXPIRY` (default `15m`)
* `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRY` (default `30d`)
* `JWT_ACCESS_SECRET_PREVIOUS` (optional — key rotation overlap)
* `JWT_ISSUER` (default `tavla-api`) / `JWT_AUDIENCE` (default `tavla-clients`)
* `ARGON2_MEMORY_COST` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM`

Full authentication design: **AUTHENTICATION_ARCHITECTURE.md**. Tunable policy values (lockout thresholds, token TTLs) are read from `SystemConfiguration` at runtime, not env vars.

## Storage (MinIO)

* `MINIO_ENDPOINT` (inside Docker Compose, the `minio` service name; `MINIO_PORT`, `MINIO_USE_SSL` alongside it) — the endpoint this process itself uses to reach MinIO for upload/delete
* `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` — the backend app's own config keys; in Docker Compose these are mapped directly from `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (below), since the app authenticates as the MinIO root user in this phase (a dedicated, least-privilege application user/policy is a future hardening item, not required for Foundation/Runtime Infrastructure)
* `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` — consumed by the `minio` container itself and by the one-shot `minio-init` service that creates buckets
* `MINIO_PUBLIC_ENDPOINT` / `MINIO_PUBLIC_PORT` / `MINIO_PUBLIC_USE_SSL` (Phase 3.2, optional — defaults to `MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_USE_SSL`) — the endpoint *presigned URLs are signed for*, i.e. what an external client (browser, mobile app) actually calls. Required whenever the backend reaches MinIO over a hostname external clients can't resolve, such as Docker Compose's `minio` service name - a presigned URL signs the Host header, so signing against the internal-only endpoint produces a URL no real client can use. `docker/.env.development` and `docker/.env.test` set this to `localhost` (the host port `docker-compose.override.yml` exposes); `docker/.env.production` must be set to the real public MinIO/CDN domain.
* `MINIO_REGION` (default `us-east-1`) — set explicitly so the SDK never needs a network round-trip to auto-detect the bucket's region when generating a presigned URL; required for `MINIO_PUBLIC_ENDPOINT` to work when that endpoint isn't itself reachable from the backend process (e.g. a container's own `localhost` loopback)
* `MINIO_PUBLIC_BUCKET` / `MINIO_PRIVATE_BUCKET`
* `MINIO_SIGNED_URL_EXPIRY_SECONDS`

## Notifications

* `ONESIGNAL_APP_ID`
* `ONESIGNAL_API_KEY`
* `NOTIFICATION_PROVIDER` (`onesignal` | `fake` — `fake` is required for Test environments, see TESTING_STRATEGY.md)

## WhatsApp Verification (ADR-022 — Phase 2.23; provider updated to LightOTP by ADR-024, 2026-07-23, implemented and live-verified)

* `LIGHTOTP_API_KEY` — server-side secret only; supplied exclusively via validated environment configuration. **Never hardcode, log, commit, or document its actual value** (this document names the variable only, per ADR-022/ADR-024's explicit instruction). Automated tests never call the real LightOTP adapter — every Customer registration/password-reset test suite overrides `VerificationMessagingPort` with an in-memory fake instead (see `TESTING_STRATEGY.md`).
* `LIGHTOTP_API_URL` (default `https://api.lightotp.com/SendMessage`)
* `LIGHTOTP_REQUEST_TIMEOUT_MS` (default `10000`)

## Platform Admin Authentication (ADR-022 — Phase 2.23, implemented and live-verified)

A genuinely separate JWT pipeline from the ordinary Customer/Owner/Employee tokens (`AUTHENTICATION_ARCHITECTURE.md` §15.2 addendum) — its own secret, issuer, and audience, never shared with `JWT_ACCESS_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE`.

* `PLATFORM_ADMIN_JWT_SECRET` — required, minimum 32 characters. **Never hardcode, log, or commit its actual value.**
* `PLATFORM_ADMIN_JWT_ISSUER` (default `tavla-platform-admin`)
* `PLATFORM_ADMIN_JWT_AUDIENCE` (default `tavla-platform-admin-clients`)
* `PLATFORM_ADMIN_JWT_EXPIRY_SECONDS` (default `900`)

There is no public Platform Admin self-registration endpoint — `PlatformAdmin` accounts are provisioned operationally (seeded directly), never via any API.

**Bootstrap (ADR-034 §10, H1 remediation).** `prisma/seed.ts` provisions the first PlatformAdmin when, and only when, all four variables below are set:

* `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` — optional; unset in every already-provisioned environment.
* `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` — optional; minimum 12 characters (`PasswordPolicy`). **Never hardcode, log, or commit its actual value.**
* `PLATFORM_ADMIN_BOOTSTRAP_FIRST_NAME` — optional.
* `PLATFORM_ADMIN_BOOTSTRAP_LAST_NAME` — optional.

Idempotent by email: re-running `prisma db seed` against an environment that already has this User/PlatformAdmin is a no-op (existing password/name are never overwritten, and no duplicate `PlatformAdmin` row is created). Set all four only on a fresh database with no PlatformAdmin yet, run the seed once, then unset the variable and rotate the password out-of-band.

## Observability

* `LOG_LEVEL`
* `LOG_PRETTY` (`true` | `false`, default `false`) — enables `pino-pretty` colorized output. `pino-pretty` is a devDependency, pruned from the production Docker image; this must only ever be set `true` for a bare-metal `pnpm start:dev` run outside Docker, never in a committed/shared env file. Setting it `true` inside the container crashes the app at boot (`unable to determine transport target for "pino-pretty"`) — this was hit and fixed during the Phase 1.2 smoke test.
* `CORRELATION_ID_HEADER` (default `x-correlation-id`)
* `SWAGGER_ENABLED` (`true` | `false`, optional) — Swagger is enabled by default in `development`, `test`, and `staging`, and **disabled in `production`** unless explicitly set `true`. Production should keep it disabled unless a deployment deliberately exposes `/api/v1/docs`.
* `REQUEST_BODY_LIMIT` (default `10mb`) — must stay aligned with Nginx's `client_max_body_size`.
* `SENTRY_DSN` (optional, per environment)

## Rate Limiting

* `RATE_LIMIT_AUTH_WINDOW_MS` / `RATE_LIMIT_AUTH_MAX`
* `RATE_LIMIT_PUBLIC_WINDOW_MS` / `RATE_LIMIT_PUBLIC_MAX`

No variable listed above may have a hardcoded fallback value committed to source control beyond a clearly-labeled local-development default; Staging and Production must fail to start if a required variable is missing, validated via a typed configuration schema at boot (see CODING_STANDARDS.md — TypeScript strict mode extends to configuration validation).

---

# Secrets Management

* **Development/Testing**: `.env` files, excluded from version control via `.gitignore`, with a committed `.env.example` documenting every variable name (no real values).
* **Staging/Production**: environment variables injected by the deployment platform's secret store (e.g., Docker secrets, a managed secrets manager) — never a `.env` file on a production host. This is tracked as an explicit hardening item beyond `.env`-based configuration, since NON_FUNCTIONAL_REQUIREMENTS.md requires "Environment secrets must never exist in source control," which `.env.example` alone satisfies, but real production secret rotation/audit requires a managed store, which remains an open decision (see DECISIONS.md Future Decisions — no specific provider has been chosen yet).

---

# Required PostgreSQL Extensions

Per DATABASE_SCHEMA.md's "Required PostgreSQL Extensions" section:

* `btree_gist` — required before the first Prisma migration runs (backs the Reservation exclusion constraint, ADR-013).
* Native `gen_random_uuid()` (PostgreSQL 13+) or `pgcrypto` — required for UUID v4 generation defaults where UUID v7 generation is handled in the application layer.

The Docker Compose PostgreSQL image must be PostgreSQL 15+ to guarantee both are available without additional installation steps.

---

# Connection Pooling Mode

`DATABASE_POOL_MODE=transaction` is required for all horizontally-scaled environments (Staging, Production) per NON_FUNCTIONAL_REQUIREMENTS.md's stateless-API-server requirement. This has a direct architectural consequence noted in ADR-012: transaction-mode pooling is incompatible with session-scoped `SET` variables, which is why PostgreSQL Row-Level Security was not adopted as the primary tenant-isolation mechanism (see TENANCY.md). `session` mode is acceptable only for local single-instance Development.

---

# Local Setup Steps

Environment files are named per stage — `.env.development`, `.env.test`, `.env.production` — not a bare `.env`. `apps/backend/.env.example` documents every variable Foundation/Runtime Infrastructure actually consume (JWT/OneSignal/rate-limit vars are added when their owning module lands).

1. Copy `apps/backend/.env.example` to `apps/backend/.env.development` and adjust if needed (the committed defaults are safe, fixed, local-only credentials — see the file's own header comment).
2. From `apps/backend/docker/`, run:
   ```bash
   docker compose --env-file ../.env.development up -d --build
   ```
   This builds the backend image and starts PostgreSQL 17, Redis 7, MinIO, the backend, and Nginx on one internal Docker network. Running from this directory (with no explicit `-f` flags) lets Compose auto-merge `docker-compose.override.yml`, which publishes each service's port to the host for local tooling — the base `docker-compose.yml` alone is production-shaped and keeps internal services unpublished.
3. The `btree_gist`/`pgcrypto` extensions are enabled automatically on first Postgres startup via `docker/postgres/init-extensions.sql`. No manual step needed.
4. Apply database migrations (Phase 2.1 foundation — `SystemConfiguration` + auth/authz/tenant tables) **from the host** (PostgreSQL port published via `docker-compose.override.yml`):
   ```bash
   cd apps/backend
   DATABASE_URL="postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public" pnpm prisma:migrate:deploy
   DATABASE_URL="postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public" pnpm prisma:seed
   ```
   This is the only supported migration workflow: the production runtime image (`apps/backend/docker/Dockerfile`'s final stage) deliberately excludes `pnpm` and the `prisma` CLI — both are devDependencies, correctly pruned so the production image doesn't carry devDependencies at runtime. Running `docker compose exec backend pnpm exec prisma migrate deploy ...` (or any `pnpm`/`prisma` command) against the running `backend` container will fail with `executable file not found in $PATH`; this is expected, not a bug, and adding those tools back to the runtime image purely to make an in-container command work would reintroduce exactly the devDependency-at-runtime risk the minimal image is designed to avoid. Always run migrations/seed from the host as shown above (or from CI against the same published/reachable `DATABASE_URL`).
5. Seed populates `SystemConfiguration` auth keys, `Roles`, `Permissions`, and `RolePermissions` (see `prisma/seed.ts`). No demo users or restaurants. `Country`, `Currency`, and `SubscriptionPlan` reference data are seeded in later phases.
6. Verify `/api/v1/health`, `/api/v1/health/readiness`, `/api/v1/health/liveness`, and `/api/v1/metrics` all respond — see README.md's "Running the Backend Locally" section for the exact URLs.

---

# Strict Verification Stack (`test:integration:verify` / `test:e2e:verify`)

`test:integration:verify`/`test:e2e:verify` (`apps/backend/scripts/run-strict-tests.js`) require a genuinely separate, ephemeral Postgres/Redis/MinIO stack — not the long-running dev stack from the steps above — so a strict run can never accidentally pass by reading data the dev stack happens to already have. `apps/backend/docker/docker-compose.strict-verify.override.yml` remaps each service to a non-conflicting host port (`15433`/`16379`/`19000-19001`/`13000`) specifically so this stack can run **concurrently** with the dev stack, with neither needing to be stopped:

```bash
# From apps/backend/docker/:
docker compose -p tavla-strict --env-file ../.env.test -f docker-compose.yml -f docker-compose.strict-verify.override.yml up -d

# From apps/backend/, apply migrations/seed the same way as step 4/5 above,
# but against the strict stack's published port:
DATABASE_URL="postgresql://tavla:tavla_test_password@localhost:15433/tavla_test?schema=public" pnpm prisma:migrate:deploy
DATABASE_URL="postgresql://tavla:tavla_test_password@localhost:15433/tavla_test?schema=public" pnpm prisma:seed

pnpm test:integration:verify
pnpm test:e2e:verify
```

`test/support/verify-env.json` (not `.env.test` directly) is what the strict launcher actually injects into the Jest process — it must point at this stack's **host-published** ports (`localhost:15433`/`16379`/`19000`), not `.env.test`'s in-container service names (`postgres`/`redis`/`minio`), since Jest always runs as a host process, never inside the Docker network. Keep it in sync if the override file's ports ever change.

---

# Recovering From Local Docker Credential/Volume Drift

PostgreSQL, like most database images, only applies `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` the **first** time it initializes an empty data directory. If `.env.development` or `.env.test` is edited afterward (a new password, a different local setup) while the corresponding named volume (`tavla_postgres-data` for the dev stack, or a `docker compose -p <project> ... .env.test` stack's own volume) already contains data, the running container keeps the **old** credentials baked in at first-init time, silently diverging from whatever the current env file says. The symptom is a Prisma `PrismaClientInitializationError` / `P1000` — `Authentication failed against database server` — even though the compose config and env file both look correct.

This is a local-development-only failure mode: `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` in `.env.development`/`.env.test` are the fixed, safe, local-only credentials documented in those files' own header comments (see `.env.example`), not production secrets, and the affected volumes hold only disposable local development/test data — never anything a `RELEASE_POLICY.md`-governed environment depends on.

**Recovery** (only after confirming the volume genuinely holds no data you need to keep):

```bash
# From apps/backend/docker/, with the affected stack stopped:
docker compose --env-file ../.env.development down
docker volume rm tavla_postgres-data   # or the equivalent volume for the stack in question
docker compose --env-file ../.env.development up -d
# Then re-apply migrations/seed per step 4 above - the fresh volume starts empty.
```

`docker volume rm` is **destructive** — it discards everything in that volume permanently. Never run it against a volume that might contain meaningful local work (in-progress manual testing data, a long-running local session) without confirming first; when automating or scripting this recovery, treat the deletion step as requiring explicit confirmation, not something to run unconditionally. This procedure does not apply to any shared, staging, or production database — those are never recreated this way (see `MIGRATION_POLICY.md`'s Rollback Strategy for the real-environment equivalent).

---

# Health Checks

Every environment must expose, per NON_FUNCTIONAL_REQUIREMENTS.md (actual paths are version-prefixed, per API_GUIDELINES.md's global URI versioning — `/api/v1/...`, not bare `/...`):

* `/api/v1/health` — overall application health, with detailed per-dependency status (PostgreSQL, Redis, MinIO)
* `/api/v1/health/readiness` — ready to accept traffic (DB/Redis/MinIO all reachable)
* `/api/v1/health/liveness` — process is alive only (never checks external dependencies — used by container orchestration to decide on restarts)
* `/api/v1/metrics` — Prometheus exposition format (process/Node.js default metrics + `http_request_duration_seconds`/`http_requests_total`), excluded from the standard JSON response envelope

All four are implemented and verified as of Phase 1.2 (Runtime Infrastructure) and must remain functional through every subsequent phase — a later feature must never cause a health check to depend on that feature's own external providers (e.g., OneSignal being down must not fail `/api/v1/health/readiness`, per the Fault Tolerance principle in NON_FUNCTIONAL_REQUIREMENTS.md).

---

# Docker Build Resilience Notes

Two issues surfaced repeatedly against a slow/rate-limited npm registry during Phase 1.2 and are worth knowing about before touching the Dockerfile:

* **`pnpm install --trust-lockfile`** — pnpm v10's default lockfile "supply-chain policies" re-verification step was consistently taking 4-6 minutes and sometimes timing out entirely. `--trust-lockfile` skips it; safe here since the lockfile is our own and committed, not a third-party input.
* **BuildKit cache mount for the pnpm store** (`--mount=type=cache,target=/pnpm/store`) — persists downloaded packages across builds even when an earlier layer (e.g. `schema.prisma`) changes and invalidates the install layer, so a slow registry only costs one full download, not one per retry.
* **`pnpm deploy`'s internal reinstall and `prisma generate` ordering** — `pnpm deploy --prod` (used to produce a flattened, production-only `node_modules` for the final image) reinstalls the target package in isolation, which re-triggers `postinstall` hooks. This was observed to non-deterministically leave Prisma's zero-model "stub" client (a `PrismaClient` whose constructor unconditionally throws) in the final image even after `SystemConfiguration` existed. Fixed by running `pnpm deploy` with `--ignore-scripts` and then a single explicit `prisma generate --schema=/prod/backend/prisma/schema.prisma` step afterward, removing any ambiguity about script execution order.
