# k6 performance suite (Phase 15 — Optimization, ADR-029)

k6 is adopted as an external tool (Go binary / `grafana/k6` Docker image), not a Node
dependency — see ADR-029 in `docs/DECISIONS.md`. Nothing here is run by the standard
Jest suites or CI pipeline (`TESTING_STRATEGY.md`'s Load Tests section: run on-demand
against a staging-like environment, ahead of major releases).

## Usage

1. Seed fixtures (creates one Owner/Organization/Restaurant/Branch/FloorPlan/Tables and
   a pool of Customer users, all `k6-` prefixed and disclosed):

   ```
   npx tsx scripts/k6/seed-k6-fixtures.ts
   ```

   Respects `DATABASE_URL` from the environment (defaults to the dev stack on
   `localhost:5433`). Writes `scripts/k6/k6-fixtures.json` (gitignored — never commit it).

2. Run a scenario against the real Nginx-fronted stack (join the compose network so the
   k6 container can resolve the `nginx` hostname, and mount this directory so k6 can
   resolve the scripts' relative `./config.js` import — piping a script via stdin does
   not work here since it breaks relative module resolution):

   ```
   docker run --rm --network tavla_tavla-network \
     -e BASE_URL=http://nginx:80/api/v1 \
     -v "$(pwd)/scripts/k6:/scripts" \
     grafana/k6 run /scripts/discovery.js
   ```

   On Windows Git Bash, prefix with `MSYS_NO_PATHCONV=1` so the container-side path
   (`/scripts/discovery.js`) is not mangled into a Windows path.

   Repeat for `reservation-availability.js`, `reservation-creation.js`, `analytics.js`.
   For the strict stack, use `--network tavla-strict_tavla-network` (the strict compose
   project's own network; its `nginx` service is reachable the same way).

3. Clean up (removes every row the seed script created, verifies row counts):

   ```
   npx tsx scripts/k6/cleanup-k6-fixtures.ts
   ```

## Thresholds

Sourced only from `docs/NON_FUNCTIONAL_REQUIREMENTS.md` — see `config.js`. No invented
SLOs. Where a scenario has no frozen numeric target, that is reported explicitly as
"NO FROZEN TARGET" rather than fabricated.

## Scope

Discovery, Reservation availability, Reservation creation, Analytics — the four surfaces
Phase 15's Architecture Freeze (`TASKS.md`) requires at minimum. Reservation creation
never disables `JwtAuthGuard`, `SessionVersionGuard`, rate limiting, or ADR-013's
advisory-lock/exclusion-constraint conflict control.
