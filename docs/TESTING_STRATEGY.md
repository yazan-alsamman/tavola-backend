# TESTING_STRATEGY.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

CLAUDE.md, CODING_STANDARDS.md, and NON_FUNCTIONAL_REQUIREMENTS.md all mandate testing (unit, integration, E2E; 90%/95% coverage targets) but none of them describe *how* tests are structured, what infrastructure they run against, or how external providers are handled. This document fills that gap and is binding for every feature module.

---

# Test Categories

## Unit Tests

Scope: a single class in isolation (Domain entity, Value Object, Domain Service, Application use case) with all dependencies (repositories, external providers) replaced by hand-written test doubles implementing the same repository/provider **interface** defined in the Domain layer — never a mock of a concrete Prisma/infrastructure class, since the Domain layer must never know Prisma exists (see ARCHITECTURE.md, DOMAIN_MODEL.md).

Required for: every Domain Service, every Application use case, every Value Object with validation logic (e.g., `Money`, `PhoneNumber`, `ReservationTime`).

## Integration Tests

Scope: a repository implementation against a **real PostgreSQL instance** (via Docker Compose in CI, per ENVIRONMENT_SETUP.md), a real Redis instance for cache/lock-related repositories, and the real Prisma Client Extension described in TENANCY.md. Integration tests never mock the database — the entire point is to verify the actual SQL behavior (constraints, exclusion constraints, advisory locks, tenant scoping) that unit tests cannot exercise.

Required for: every repository, the Prisma Client Extension itself (tenant-scoping correctness, per TENANCY.md's Testing Requirements section), the reservation advisory-lock/exclusion-constraint mechanism (ADR-013), any BullMQ job handler that touches the database, and **Phase 2.1 database foundation** (`test/database/schema.integration-spec.ts` — constraints, partial indexes, cascades, soft delete).

Run via `pnpm --filter backend test:integration` (requires PostgreSQL; skips gracefully when unreachable).

## End-to-End (E2E) Tests

Scope: a full request through the running NestJS application (HTTP or WebSocket), a real database, and **fake/sandboxed external providers** (see External Provider Policy below) — verifying complete business workflows rather than individual layers.

Required for critical workflows, per CODING_STANDARDS.md and NON_FUNCTIONAL_REQUIREMENTS.md:

* Authentication (register → verify → login → refresh → logout)
* Reservation Engine (search availability → create → approve → complete; and the conflict path: two concurrent creation attempts for the same table/slot, asserting exactly one succeeds)
* Notifications (event → template resolution → provider dispatch, using the fake provider)
* Realtime Gateway (a REST action triggers the correct WebSocket broadcast to an authorized, connected client, and is *not* received by an unauthorized client)

## Load Tests

Scope: not run in the standard CI pipeline; run against a staging environment ahead of major releases. Validates the response-time and throughput targets in NON_FUNCTIONAL_REQUIREMENTS.md (Public/Authenticated API and Heavy Operations latency budgets). Tooling: **k6** (ADR-029, architecture frozen 2026-07-30 — Artillery/Gatling rejected). Scripts are not part of this Jest suite; they run as an external tool per ADR-029. Implemented under Phase 15 (Optimization) covering Discovery, Reservation availability, Reservation creation, and Analytics (`apps/backend/scripts/k6/`), run against the rebuilt production image with raw summary-export artifacts preserved — see `TASKS.md`'s Phase 15 reports.

---

# Coverage Targets

Per NON_FUNCTIONAL_REQUIREMENTS.md:

* Minimum overall coverage: **90%**
* Critical modules (Reservation Engine, Authentication, Notifications, Realtime Gateway): **95%**, and these four modules specifically require integration *and* E2E tests, not unit tests alone.

Coverage is measured on the Domain and Application layers primarily — Infrastructure adapters (thin wrappers around Prisma/Redis/MinIO/OneSignal calls) are exercised through integration tests rather than chased for line coverage in isolation.

---

# Test Data Strategy

* **Unit tests** construct Domain entities directly via their constructors/factories with in-memory test doubles — no database involved, no fixtures needed.
* **Integration and E2E tests** use a dedicated test database (`tavla_test`), reset between test files via Prisma's migration reset, never sharing state with the development database. A minimal, deterministic seed (Roles, Permissions, Country/Currency reference data, one Organization/Restaurant/Branch fixture) is applied once per test run via the same Seed System used for local development (see ENVIRONMENT_SETUP.md), not duplicated as ad hoc SQL inside test files.
* **Tenant-isolation tests** (per TENANCY.md) always construct at least two Organizations in the fixture set, specifically to assert that data from one is never visible while Tenant Context is bound to the other.
* Test data builders (factory functions, not fixture files) are the required pattern for constructing entities in integration/E2E tests, so a test can override only the fields relevant to its scenario without duplicating full entity definitions across test files.

---

# External Provider Policy

Real third-party providers (OneSignal, MinIO in its hosted form, and — as of ADR-022, currently LightOTP per ADR-024 — the Customer OTP delivery provider) are **never called from any automated test**, including E2E tests. No real WhatsApp message is ever sent by a test. Fake implementations are required, both satisfying the same interface as the real Infrastructure adapter (`NotificationProvider`, `FileStorageService`, and `VerificationMessagingPort` once implemented):

* **In-memory fake**, used by unit and most integration tests — records calls made to it for assertions, returns configurable canned responses.
* **Local sandboxed equivalent**, used by E2E tests where a closer-to-real integration matters — e.g., MinIO's own Docker image running locally (already part of the Docker Compose stack per ARCHITECTURE.md) rather than a fake for file storage, since MinIO is self-hosted and safe to run in CI; OneSignal remains fully faked in all test tiers since it is an external SaaS service with no safe local equivalent.

TAVLA does not process payments and has no payment provider integration (Owner Decision, 2026-07-28 — see `TASKS.md` Phase 13); no payment-related test infrastructure is planned.

CI must never hold or require real third-party API keys. If a provider's SDK requires a key to instantiate even in a disabled/sandbox mode, a dummy value is used and documented in ENVIRONMENT_SETUP.md's test environment section.

---

# Reservation Concurrency Testing (ADR-013)

Because reservation conflict prevention is the platform's most safety-critical invariant, it requires a dedicated test pattern beyond standard CRUD integration tests:

* A concurrency integration test spins up N parallel requests (via `Promise.all` against N separate Prisma Client instances, simulating N separate API-server connections) attempting to create/approve overlapping reservations for the same `(branch, table, timeslot)`. The test asserts exactly one succeeds and the rest receive `ReservationConflictException`.
* A second variant intentionally bypasses the application-level advisory lock (calling the repository's raw insert path directly, simulating a hypothetical future bug) to assert the database exclusion constraint independently rejects the conflicting row — verifying the "defense in depth" property claimed in ADR-013 actually holds, not just the primary path.

---

# CI Execution

* Unit tests run on every commit/PR, no external services required, must complete in well under a minute.
* Integration tests run on every PR against ephemeral PostgreSQL/Redis containers (via Docker Compose, per ENVIRONMENT_SETUP.md), torn down after the run.
* E2E tests run on every PR against the full application stack with fake providers, as the final CI gate before merge.
* Load tests are not part of the PR pipeline; they run on a schedule/pre-release basis against staging, per the CI/CD pipeline design (tracked as a pending ADR/document — see DECISIONS.md Future Decisions).

`pnpm test:integration`/`pnpm test:e2e` skip gracefully (with a warning, not a failure) when their required infrastructure is unreachable — the correct behavior for a developer running tests locally without the Docker stack up. CI, and anyone needing a real guarantee that infrastructure-backed assertions actually ran, must instead use `pnpm test:integration:verify`/`pnpm test:e2e:verify`: these automatically enable strict mode (no manual shell environment variable needed — see `scripts/run-strict-tests.js`) and fail the run non-zero if required PostgreSQL/Redis is unavailable, rather than silently skipping and reporting a false-green result.

No feature is merged with failing tests at any tier, per CODING_STANDARDS.md's Quality Gates.

---

# Phase 1 Foundation Tests (Infrastructure)

Phase 1 ships automated coverage for cross-cutting infrastructure only — no business modules exist yet. These tests are required before Phase 2 begins:

| Area | Test file | Tier |
|---|---|---|
| Environment validation (Joi schema) | `src/config/env.validation.spec.ts` | Unit |
| Global exception filter + error codes | `src/common/filters/global-exception.filter.spec.ts` | Unit |
| Global ValidationPipe | `src/common/pipes/validation-pipe.factory.spec.ts` | Unit |
| Response envelope interceptor | `src/common/interceptors/response-envelope.interceptor.spec.ts` | Unit |
| Correlation ID sanitization | `src/infrastructure/logging/correlation-id.util.spec.ts` | Unit |
| Health, metrics, correlation ID, 404 envelope | `test/phase1.e2e-spec.ts` | E2E |

**E2E prerequisites:** the Docker Compose stack must be running (`docker compose --env-file ../.env.development up -d` from `apps/backend/docker/`) so PostgreSQL, Redis, and MinIO are reachable on the published localhost ports. The E2E setup file (`test/jest-e2e.setup.ts`) defaults to those localhost credentials.

**Phase 2 Authentication tests** (once implemented): see AUTHENTICATION_ARCHITECTURE.md §13 — Authentication module requires 95% coverage, unit + integration + E2E per NON_FUNCTIONAL_REQUIREMENTS.md.

Run:

```bash
pnpm --filter backend test        # unit tests only — no external services
pnpm --filter backend test:e2e    # requires the Docker stack above
```
