# 🍽️ TAVLA

> **Enterprise Restaurant Reservation Platform**

TAVLA is a production-grade, enterprise-level SaaS platform that enables restaurants to manage reservations, tables, branches, employees, menus, offers, subscriptions, and analytics through a centralized backend.

The platform is designed to serve **thousands of restaurants**, **millions of users**, and support **multiple countries, languages, and currencies**.

---

# Project Status

Current Stage

> ✅ Phase 2.22 (Security Test Suite + Load Smoke) — **COMPLETE**. Phase 2 exit criteria met. Post-Phase-2 Docker production-image fix and Post-Phase-2 Test Infrastructure Hardening also complete — the `backend` image builds, starts, and passes health checks cleanly, and `test:integration:verify`/`test:e2e:verify` are now genuinely fail-closed with no order-dependent flakes (a leftover port-mismatch in `test/support/verify-env.json` was found and fixed during Phase 3.3). Phase 3 was explicitly approved; all four sub-scopes, **User Profile** (`GET`/`PATCH /api/v1/users/me`), **Avatar Upload** (`POST /api/v1/users/me/avatar`), **Favorites** (`POST`/`DELETE /api/v1/users/me/favorites/:restaurantId`, `GET /api/v1/users/me/favorites`), and **Preferences** (`GET`/`PATCH /api/v1/users/me/preferences`), are now implemented and **fully live-verified** against real Docker/PostgreSQL/Redis/MinIO (both the dev stack and the isolated strict-verification stack), including a full manual HTTP flow through Nginx — see TASKS.md's "Phase 3.1", "Phase 3.2", "Phase 3.3", "Phase 3.4 — User Module: Preferences", "Phase 3.4 Live Verification", and "Phase 3.4.1 Global Boolean Validation Fix" reports. Live verification found one real, pre-existing, platform-wide defect unrelated to Preferences' own logic — the global `ValidationPipe`'s implicit type conversion was silently coercing any non-empty string to `true` for every `@IsBoolean()`-decorated field (`UpdateUserPreferencesRequestDto` and, pre-existing, `RegisterConsentsRequestDto` from Phase 2) — which was fixed in a dedicated follow-up session (removed the global `enableImplicitConversion` flag; the one legitimate consumer of implicit numeric conversion, `ListFavoritesQueryDto`'s pagination, now uses explicit `@Type(() => Number)` instead) and re-verified with zero regressions. **Phase 3 — User Module is now fully verified, with zero known defects.** Phase 4 — Restaurant Module was explicitly approved and is now **fully complete**, all five sub-scopes live-verified: **Restaurant CRUD** (`POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants`, `GET /api/v1/restaurants/:id`, see TASKS.md's "Phase 4.1" report), **Restaurant Settings** (`GET`/`PATCH /api/v1/restaurants/:id/settings`, see TASKS.md's "Phase 4.2" report), **Working Hours** (`GET`/`PATCH /api/v1/restaurants/:id/working-hours`, Restaurant-level default only - branch-level override explicitly deferred to Phase 5, see TASKS.md's "Phase 4.3" report), **Gallery** (`POST`/`GET /api/v1/restaurants/:id/gallery`, `DELETE /api/v1/restaurants/:id/gallery/:galleryItemId`, Restaurant-level only, max 20 images, completely reusing the existing Files module/MinIO public bucket rather than a second upload subsystem, see TASKS.md's "Phase 4.4" report), and **Cuisine & Occasion Taxonomy Assignment** (`GET`/`PATCH /api/v1/restaurants/:id/cuisine-categories`, `GET`/`PATCH /api/v1/restaurants/:id/occasion-categories`, plus public `GET /api/v1/cuisine-categories`/`GET /api/v1/occasion-categories`, ADR-018, see TASKS.md's "Phase 4.5" report), all implemented and live-verified end-to-end (unit, non-strict and strict integration/E2E against two separate stacks, Docker, and a manual HTTP flow through Nginx). Restaurant management is scoped exclusively to `OrganizationMember` (Owner/Admin) actors via `OrganizationMemberGuard`/`@RequireOrgRole()` - the first real implementation of AUTHORIZATION_ARCHITECTURE.md's already-locked organization-administrative authorization layer, reused unchanged for Settings, Working Hours, Gallery, and Taxonomy Assignment. Restaurant CRUD required no schema/migration change; Restaurant Settings, Working Hours, Gallery, and Taxonomy Assignment each required one additive migration (`restaurant_settings`, `working_hours`, `restaurant_gallery`, and the four cuisine/occasion taxonomy tables respectively; the taxonomy assignment tables are the only ones with no auto-provisioned defaults AND no owner-facing creation step for the reference data itself - `CuisineCategory`/`OccasionCategory` are platform-managed, seeded at deploy). **Phase 4 — Restaurant Module is now fully verified, with zero known defects.** Phase 5 — Branch Module has begun: **Branch CRUD** (`POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants/:restaurantId/branches[/:branchId]`, using the pre-existing `Branch` table from the Phase 2.1 foundation migration - no new migration required, see TASKS.md's "Phase 5.1" report) is implemented and live-verified end-to-end (unit, integration, strict integration, E2E, strict E2E, Docker, and a manual HTTP flow). `Branch` carries no direct `organizationId` column - every use case resolves the parent Restaurant via the already-tenant-scoped `RestaurantRepository` first, the same relation-path pattern Working Hours/Restaurant Settings use, now crossing a module boundary since Branch is its own top-level feature module. Geo coordinates, opening hours, Maps integration, and structured Address handling are explicitly deferred to later Branch sub-phases. **Phase 5.1 — Branch CRUD is fully verified, with zero known defects.** Working Schedule (Phase 5.2) is also now **complete and live-verified**: **Branch Working Hours** (`GET`/`PATCH /api/v1/restaurants/:restaurantId/branches/:branchId/working-hours`, see TASKS.md's "Phase 5.2" report) is a new `BranchWorkingHours` 1:many child entity of the Branch aggregate - a separate table from Restaurant's own `WorkingHours` (not a nullable `branchId` bolted onto it), resolving the branch-level override Phase 4.3 explicitly deferred to Phase 5. Neither `Branch` nor `BranchWorkingHours` carries a direct `organizationId` column - every use case resolves the parent Restaurant (and, for working hours, the parent Branch too) via the already-tenant-scoped repositories first. One additive migration, no tenant-scoping extension change, the same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization reused unchanged. **Phase 5.2 — Working Schedule is fully verified, with zero known defects.** Geo Coordinates for Nearby Search (Phase 5.3, ADR-018) is also now **complete and live-verified**: `latitude`/`longitude` (already-existing but unused `Branch` columns) are now exposed via `POST`/`PATCH /api/v1/restaurants/:restaurantId/branches[/:branchId]`, both-or-neither paired and range-validated, with a new composite `(latitude, longitude)` index. The actual bounding-box "nearby restaurant" search query remains out of scope - ADR-018 attributes that to a future, unscheduled Discovery module (Phase 15.5). "Maps" and "Address" (the two remaining Phase 5 checklist items) were found to have zero concrete specification anywhere in the documentation and were reported as STOP conditions rather than guessed at; Geo Coordinates was chosen instead as the next concretely-documented item. **Phase 5.3 — Geo Coordinates is fully verified, with zero known defects.** **Address is now reclassified as complete** (documentation-only reconciliation, no new implementation): `PRODUCT_REQUIREMENTS.md` FR-04.2 requires only address/city/district/country/timezone/currency/geo coordinates, all already fully delivered by Phase 5.1 and Phase 5.3 - `DOMAIN_MODEL.md`'s `Address` Value Object is a generic, aggregate-unbound illustrative example, not a requirement bound to `Branch`, and does not require `postalCode`, a formal `Address` Value Object, or aggregate refactoring. **Maps has been frozen by an approved architectural decision** (2026-07-16), not left blocked: Maps is not a backend feature. Backend responsibility ends at exposing accurate geographic coordinates, already delivered in Phase 5.3 (`latitude`/`longitude`). Rendering maps, selecting a map provider, generating map URLs, launching navigation apps, and visual map presentation are client responsibilities - no Maps module, entity, Value Object, provider port, infrastructure adapter, schema change, or API change was made or is required. A future backend-specific map capability (server-side geocoding, provider integration, signed URLs) would require its own Product Requirement and ADR, proposed as an entirely new feature. **Phase 5 — Branch Module is now fully COMPLETE**, with zero known defects across all four delivered sub-scopes (Branch CRUD, Working Schedule, Geo Coordinates, Address) and Maps closed by architectural decision. Phase 6 — Table Module has begun: **Phase 6.1 (Floor Plan & Table CRUD)** is now **complete and live-verified** — **FloorPlan** Create/List/Activate (`POST`/`GET /api/v1/restaurants/:restaurantId/branches/:branchId/floor-plans`, `PATCH .../floor-plans/:floorPlanId/activate`) and **Table** Create/Update/Soft-Delete/Read/List (`POST`/`GET /api/v1/restaurants/:restaurantId/branches/:branchId/tables`, `GET`/`PATCH`/`DELETE /api/v1/tables/:tableId`, plus the FloorPlan-scoped `GET .../floor-plans/:floorPlanId/tables`), all owned by a new, dedicated `TablesModule` per Phase 6.1's frozen architecture decisions (see TASKS.md's "Phase 6.1 — Table Module: Floor Plan & Table CRUD" report). `DeleteBranchUseCase` now cascades to soft-delete a branch's FloorPlans and Tables inside one transaction. `Table.status`/`Table.shape` are intentionally minimal (`Available`-only; `Rectangle`/`Round`-only) per an explicit pre-implementation architecture decision, resolving a real documentation gap rather than inventing values. Merge Tables and Split Tables are deferred until the Reservation Engine architecture has been approved and frozen (not cancelled - an explicit, approved architecture decision, see TASKS.md's "Phase 6 — Merge/Split Tables Deferral" note); **Phase 6.1 is fully verified, with zero known defects.** **Phase 6.2 (Move Table)** is also now **complete and live-verified**: `POST /api/v1/tables/:tableId/move` is a dedicated Domain Action (not folded into `PATCH /tables/:tableId`) that changes only a Table's `floorPlanId`, within the same Branch - the target FloorPlan must exist, belong to that Branch, and not be soft-deleted, or the request is rejected with 404 (unknown, cross-branch, and soft-deleted targets all collapse to the same response, an IDOR-safe pattern reused from every other Table route). No schema/migration change was needed. No `TableMovedEvent` domain event exists by explicit architecture decision - Move Table produces a `table.moved` audit-log entry only. **Phase 6.2 is fully verified, with zero known defects.** **Status Management** is also now **complete and live-verified**: `POST /api/v1/tables/:tableId/status` is the single dedicated Domain Action for every status transition (no separate disable/enable endpoints) - `TableStatus` now consists of `Available`/`Occupied`/`Cleaning`/`Disabled` (extended via one additive migration), restricted to a state machine allowing only `Available ↔ Occupied`, `Available ↔ Cleaning`, and `Available ↔ Disabled`; every other combination, including a same-status "transition," is rejected. `Reserved` remains excluded, deferred until the Reservation Engine architecture is approved and frozen. `Update Table` still never changes `status`. No `TablePolicy` was introduced - the existing `OrganizationMemberGuard`/`@RequireOrgRole()` stack is reused unchanged. No domain event exists - status transitions produce a `table.status_changed` audit-log entry only. **Status Management is fully verified, with zero known defects.** Phase 7 (Reservation Engine): Phase 7.0 (Employee Management) is complete and live-verified. **Phase 7.1 (Reservation Core) is now complete, live-verified, and production-verified** (2026-07-20, see TASKS.md's "Phase 7.1 — Reservation Core" report): Search Availability (`GET /api/v1/reservations/availability`) and Create Reservation (`POST /api/v1/reservations`) are implemented end-to-end, with reservation end-time derivation (backend-authoritative, client-supplied-or-derived) and the Availability Search response contract (informational only, reserved tables remain visible and marked as such) both delivered exactly per the frozen architecture decisions. ADR-013 (advisory lock + database exclusion-constraint safety net) is now fully implemented, including a post-completion compliance fix that closes the one gap a consistency review found (the exclusion constraint's own database-level violation is now caught and mapped to `ReservationConflictException`, not left to leak as a raw error) - see TASKS.md's "ADR-013 compliance fix" note. Auto-approval, `Table.reserve()`/`TableStatus.Reserved`, Approve, and Reject are explicitly deferred to Phase 7.2 by an approved Scope Amendment, not an oversight. **Phase 7.1 — Reservation Core is fully verified, with zero known defects.** **Phase 7.2 (Approval Workflow) is now COMPLETE, LIVE VERIFIED, and PRODUCTION VERIFIED** (2026-07-23, see TASKS.md's "Phase 7.2 — Approval Workflow" report): `POST /api/v1/reservations/:id/approve` and `POST /api/v1/reservations/:id/reject` are implemented end-to-end. Approve transitions `Pending → Approved`, calls `Table.reserve()` (new `TableStatus.Reserved`, additive migration) atomically with the status transition (ADR-013's advisory lock and confirmed-overlap re-check now cover Approval as well as Create, exactly as ADR-013's own Decision text already specified), and auto-rejects any other overlapping `Pending` reservation for the same table. Reject - per the approved Architecture Correction - performs no Table operation at all (structurally: `RejectReservationUseCase` has no `TableRepository` dependency), since a reservation can only be rejected while still Pending and a Pending reservation never reserves a table. The auto-approval branch of Create Reservation is also complete: when `RestaurantSettings.autoApproval = true`, a reservation is created directly as `Approved` (never `Pending`) with `Table.reserve()` applied in the same transaction as the insert. Both endpoints require the Employee actor's `reservations:approve` permission and enforce branch scope; Customer/Platform-Admin actors cannot reach them. **Phase 7.3 (Reservation Lifecycle) is now COMPLETE, LIVE VERIFIED, and PRODUCTION VERIFIED** (2026-07-23, see TASKS.md's "Phase 7.3 — Reservation Lifecycle" report and ADR-023): `POST /api/v1/reservations/:id/{cancel,reschedule,complete,no-show}` are all implemented end-to-end. Cancel and Reschedule are reachable by both the reservation's own Customer (ownership-based) and a branch-scoped Employee (new dedicated permission slugs `reservations:cancel`/`reservations:reschedule` - never a reuse of `reservations:approve`) on the same route, resolved by use-case-level actor branching rather than new guard composition. Complete and No-Show remain Employee-only (`reservations:complete`/`reservations:noshow`), calling `Table.release()` unconditionally back to `Available` (never through `TableStatus.Cleaning`, which stays a separate, Status-Management-only state). Reschedule may change a reservation's assigned Table within the same Branch - ADR-023 extends ADR-013's single-table advisory-lock mechanism with a deterministic two-key locking protocol for that one case (proven against real `pg_advisory_xact_lock` calls), without altering ADR-013's own text. `ReservationHistory` (already documented in DATABASE_SCHEMA.md) is now implemented and persisted, with `oldTableId`/`newTableId` populated only for table-changing reschedules. A real BullMQ/Redis expiration flow was live-verified end-to-end, including a genuine production bug found and fixed during that verification (the scheduler's job id originally contained `:`, which BullMQ rejects as its own internal Redis key delimiter). **Phase 7.4 (Phone & Walk-In Reservations) is now COMPLETE, LIVE VERIFIED, and PRODUCTION VERIFIED** (2026-07-23, see TASKS.md's "Phase 7.4 — Phone & Walk-In Reservations" report): the same `POST /api/v1/reservations` endpoint now also accepts `source: Phone|WalkIn` + a `reservationGuest` payload, reachable only by a branch-scoped Employee holding the existing `reservations:create` permission (no new permission slug) - a new `ReservationGuest` entity is persisted atomically with the `Reservation` row (proven against a real Postgres transaction: a database-level conflict leaves no orphan guest row), with `userId` null and `reservationGuestId` set, `createdBy` attributed to the Employee's own id. `source: Online` remains reachable by any authenticated actor type for themselves, unchanged from Phase 7.1's own original design - an authorization-matrix over-narrowing that would have broken this was found and corrected during implementation, not shipped. `RestaurantSettings.autoApproval` applies identically regardless of source, with no source-specific approval behavior introduced.

Owner/staff login, refresh, logout, session management, forgot/reset/change password are all implemented end-to-end, with Redis-backed sliding-window rate limiting on login/refresh/forgot-password/reset-password/change-password, a persistent audit trail for every security-sensitive authentication action, and every applicable domain event (LoggedIn/Out, SessionRevoked, Refreshed, Replay/Family-Compromise detection, PasswordChanged/Reset/ResetRequested, AccountLocked) published exactly once, after commit. Phase 2.22 closed out Phase 2 with a security audit (fixing one real gap — `change-password` previously had no rate limit) and a load-smoke test proving the app survives concurrent bursts against real infrastructure without failures.

**Phase 2.23 — COMPLETE / LIVE VERIFIED / PRODUCTION VERIFIED (2026-07-22):** ADR-022 (`docs/DECISIONS.md`, Accepted/Frozen) is now fully implemented. Customer registration is phone-first (username + phone — mobile Country Code Picker defaults to Syria +963, customer may select any other supported country, backend normalizes to canonical E.164 per ADR-022 Decision #13 — WhatsApp OTP via LightOTP per ADR-024 (2026-07-23, formerly Fonnte), no email ever) via `POST /auth/customer/register/{start,resend,verify,complete}`, `POST /auth/customer/login`, and `POST /auth/customer/password-reset/{start,resend,verify,complete}`. The public Owner self-registration endpoint (`POST /auth/register`) and email verification (`POST /auth/verify-email`) are **retired** — Restaurant Owner accounts are now provisioned exclusively by an authenticated Platform Admin via `POST /platform-admin/restaurant-owners` (`POST /platform-admin/login` for Platform Admin authentication, a genuinely separate JWT issuer/audience/secret from the ordinary Customer/Owner/Employee pipeline), with no email-verification step for either actor. See `AUTHENTICATION_ARCHITECTURE.md` §15 for the authoritative current model and `TASKS.md`'s Phase 2.23 closure report for full verification evidence (775 unit / 159 integration / 298 E2E tests, both the dev and strict-verify Docker stacks, live manual HTTP verification).

**LightOTP Provider Migration — COMPLETE (2026-07-23, ADR-024):** the Customer phone/WhatsApp OTP delivery provider was migrated from Fonnte to LightOTP (`https://lightotp.com`), superseding only ADR-022's "Fonnte Integration Boundary" subsection - no other Customer authentication architecture changed. `VerificationMessagingPort` absorbed the swap with zero application/domain-layer changes; `LightOtpVerificationMessagingAdapter` replaces `FonnteVerificationMessagingAdapter`. Canonical E.164 (with its leading `+`) is now sent directly as LightOTP's `toPhoneE164` field, with no adapter-side stripping (the opposite of Fonnte's format). LightOTP's API has no free-text message/template field, so the previously approved WhatsApp copy can no longer be sent as application-controlled text - a disclosed, mechanical consequence of the real provider contract, not a silently-dropped requirement. See `docs/DECISIONS.md` ADR-024 and `TASKS.md`'s migration report for full verification evidence.

The architecture, domain model, database design, coding standards, and development roadmap were completed before writing any code (Phase 0/0.5). The NestJS application, its full module structure, and the local Docker Compose runtime (PostgreSQL, Redis, MinIO, Nginx) now exist and are verified working end-to-end.

**TASKS.md is the single authoritative phase list** for this project. The `Project Phases` section below is a short narrative summary for newcomers — for exact phase numbers, checklists, and completion status, see `TASKS.md` (and `docs/PROJECT_ROADMAP.md`, which mirrors the same numbering with additional detail).

---

# Running the Backend Locally

Requires Docker Desktop (with Compose v2) and Node.js 20+/pnpm only if you want to run tooling (lint, tests) outside a container.

```bash
# From the repo root, install workspace dependencies (only needed for local
# tooling - the Docker build installs its own dependencies independently):
pnpm install

# Bring up the full stack (PostgreSQL, Redis, MinIO, backend, Nginx).
# Run from apps/backend/docker/ so Compose auto-merges the dev override
# (docker-compose.override.yml), which publishes ports for local tooling:
cd apps/backend/docker
docker compose --env-file ../.env.development up -d --build

# Check that everything is healthy:
docker compose --env-file ../.env.development ps

# Run automated tests (unit tests need no Docker; E2E needs the stack above):
cd ../..
pnpm --filter backend test
pnpm --filter backend test:e2e
```

Once running:

| What | URL |
|---|---|
| API (direct) | http://localhost:3000/api/v1 |
| API (through Nginx) | http://localhost/api/v1 |
| Swagger | http://localhost:3000/api/v1/docs |
| Health (detailed: Postgres/Redis/MinIO) | http://localhost:3000/api/v1/health |
| Liveness | http://localhost:3000/api/v1/health/liveness |
| Readiness | http://localhost:3000/api/v1/health/readiness |
| Prometheus metrics | http://localhost:3000/api/v1/metrics |
| MinIO console | http://localhost:9001 |

`.env.development` contains fixed, non-secret local credentials — see `apps/backend/.env.example` and `docs/ENVIRONMENT_SETUP.md` for what every variable means. Never commit real secrets; `.env.production` in the repo is a placeholder template only (see its own header comment).

To stop the stack: `docker compose --env-file ../.env.development down` (add `-v` to also delete the named volumes and start from a clean database).

---

# Vision

Build the most scalable restaurant reservation platform in the region.

Core objectives:

- Enterprise Architecture
- Multi-Tenant SaaS
- High Performance
- Security by Design
- Horizontal Scalability
- Real-Time Reservations
- Long-Term Maintainability

---

# Technology Stack

## Backend

- NestJS
- TypeScript
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ
- Socket.IO
- JWT Authentication
- Argon2
- OneSignal
- MinIO
- Docker
- Docker Compose
- Nginx
- Swagger
- Pino Logger

---

## Frontend (Future)

- Next.js
- React
- TypeScript

---

## Mobile (Future)

- Flutter

---

# Project Structure

```
TAVLA/
│
├── apps/
│   └── backend/
│       ├── src/
│       │   ├── config/            # typed config + env validation
│       │   ├── common/            # filters, interceptors, pipes, decorators
│       │   ├── shared/            # cross-context domain base classes/VOs
│       │   ├── infrastructure/    # Prisma, Redis, BullMQ, MinIO, health, metrics, logging
│       │   └── modules/           # 17 bounded-context modules (empty until their phase)
│       ├── prisma/                # schema.prisma, migrations/
│       └── docker/                # Dockerfile, docker-compose.yml, nginx/, postgres/, redis/, minio/
│
├── docs/
│   ├── API_GUIDELINES.md
│   ├── ARCHITECTURE.md
│   ├── CODING_STANDARDS.md
│   ├── DATABASE_SCHEMA.md
│   ├── DECISIONS.md
│   ├── DOMAIN_MODEL.md
│   ├── ENVIRONMENT_SETUP.md
│   ├── EVENTS.md
│   ├── LOCALIZATION.md
│   ├── NON_FUNCTIONAL_REQUIREMENTS.md
│   ├── PROJECT_ROADMAP.md
│   ├── TENANCY.md
│   └── TESTING_STRATEGY.md
│
├── CLAUDE.md
├── TASKS.md
├── README.md
└── .gitignore
```

---

# Documentation

The `/docs` directory contains the complete engineering documentation.

| Document | Purpose |
|----------|---------|
| PRODUCT_REQUIREMENTS.md | **Business source of truth** — functional requirements (PRD) |
| ARCHITECTURE_COMPLIANCE_AUDIT.md | Architecture lock compliance audit report (2026-07-07) |
| ARCHITECTURE.md | System architecture |
| DOMAIN_MODEL.md | Domain-driven design model |
| DATABASE_SCHEMA.md | Database specification |
| API_GUIDELINES.md | REST API standards |
| AUTHENTICATION_ARCHITECTURE.md | Phase 2 authentication design (identity, sessions, JWT) |
| AUTHORIZATION_ARCHITECTURE.md | Phase 2 authorization design (RBAC, policies, guards) |
| ARCHITECTURE_LOCK.md | Locked architectural decisions (pre-Phase 2.1 freeze) |
| CHANGE_POLICY.md | ADR requirements, documentation and review policy |
| MIGRATION_POLICY.md | Prisma migration and schema evolution rules |
| VERSIONING.md | Semantic versioning and API versioning |
| RELEASE_POLICY.md | Release workflow and deployment gates |
| BRANCHING_STRATEGY.md | Git branching and commit conventions |
| CODING_STANDARDS.md | Development rules |
| EVENTS.md | Domain & WebSocket events |
| DECISIONS.md | Architecture Decision Records |
| PROJECT_ROADMAP.md | Development roadmap (mirrors TASKS.md numbering) |
| NON_FUNCTIONAL_REQUIREMENTS.md | Performance, scalability & security |
| TENANCY.md | Multi-tenant isolation mechanism and tenant context flow |
| TESTING_STRATEGY.md | Test types, coverage targets, fixtures, CI test execution |
| ENVIRONMENT_SETUP.md | Local/dev/staging/production environment configuration |
| LOCALIZATION.md | Multi-language, multi-currency, and RTL/LTR strategy |

---

# Development Principles

This project follows:

- Clean Architecture
- Domain Driven Design (DDD)
- SOLID Principles
- Repository Pattern
- Dependency Injection
- Modular Architecture
- Feature-Based Development
- API First Design
- Security First
- Documentation Driven Development

---

# Development Workflow

Every feature follows this lifecycle:

```
Planning
    ↓
Architecture Review
    ↓
Documentation (must precede implementation — see CHANGE_POLICY.md)
    ↓
Implementation (must conform to ARCHITECTURE_LOCK.md)
    ↓
Testing
    ↓
Review (per CHANGE_POLICY.md)
    ↓
Production Ready (per RELEASE_POLICY.md)
```

No feature is implemented before its architecture has been reviewed.

---

# Project Phases (Summary)

This is a grouped, narrative summary only. Exact phase numbers and checklists live in `TASKS.md`.

| Group | TASKS.md Phases | Covers |
|---|---|---|
| Architecture Finalization | Phase 0 | Domain model, database schema, ADRs, documentation consistency |
| Infrastructure | Phase 1 | NestJS, PostgreSQL, Prisma, Redis, Docker, BullMQ, Swagger, Logging |
| Architecture Governance | Phase 2.0.2 | Architecture lock, change/migration/versioning/release/branching policies |
| Authentication | Phase 2 | JWT, Refresh Tokens, Session Management, Token Families |
| Authorization | Phase 2 | RBAC, Policies, PermissionResolver, Scope Guards |
| Core Modules | Phases 3–6 | Users, Organizations, Restaurants, Branches, Employees, Tables |
| Reservation Engine | Phase 7 | Reservation Workflow, Phone Reservations, Conflict Detection, Real-Time Availability |
| Real-Time Features | Phase 8 | Socket.IO, Redis Adapter, Live Table Updates, Live Reservation Updates |
| Platform Features | Phases 9–14 | Notifications, Reviews, Offers, Subscriptions, Payments, Analytics |
| Hardening | Phases 15–17 | Optimization, Testing, Deployment |

---

# Design Goals

The backend is designed to support:

- Unlimited restaurants
- Unlimited branches
- Unlimited employees
- Multiple languages
- Multiple currencies
- Multi-country deployment
- Future microservices migration

---

# Security

The platform implements:

- JWT Authentication
- Refresh Tokens
- RBAC
- Argon2 Password Hashing
- Rate Limiting
- Secure File Uploads
- Audit Logs
- Request Validation
- Structured Logging

---

# Real-Time System

Socket.IO is used for:

- Reservation Updates
- Table Availability
- Notification Delivery
- Dashboard Synchronization

---

# Notifications

Notification providers are abstracted.

Current provider:

- OneSignal

Future providers:

- Apple Push Notifications
- Huawei Push
- Email
- SMS

---

# Storage

Files are stored using MinIO.

Examples:

- Restaurant Images
- Menu Images
- User Avatars
- Review Images

---

# Background Jobs

BullMQ handles:

- Reservation Reminders
- Notification Delivery
- Report Generation
- Scheduled Tasks
- Cleanup Jobs

---

# Database

Primary Database

- PostgreSQL

Cache

- Redis

Storage

- MinIO

---

# Quality Standards

Every feature must include:

- Documentation
- Unit Tests
- Integration Tests (where applicable)
- Swagger Documentation
- Architecture Compliance

No code is merged until all quality gates pass.

---

# Production Requirements

The platform targets:

- 10,000+ Restaurants
- 500,000+ Users
- 100,000+ Reservations per Day
- 25,000+ Concurrent WebSocket Connections

---

# Development Rules

Before writing code:

1. Read all documents in `/docs`.
2. Follow `CLAUDE.md`.
3. Check `TASKS.md`.
4. Review architecture.
5. Implement only the current phase.

---

# License

Private Project

All rights reserved.

---

# Engineering Philosophy

> Build software that remains scalable, maintainable, secure, and understandable five years from now.

Every engineering decision should prioritize long-term quality over short-term speed.