# PROJECT ROADMAP

## Project

**Enterprise Restaurant Reservation Platform**

Version: **1.1**

Status: **Phases 0–5 COMPLETE. Phase 6 COMPLETE — CRUD/Move/Status COMPLETE; Merge/Split Tables IMPLEMENTED, LIVE VERIFIED (2026-07-26, ADR-026; architecture frozen 2026-07-25). Phase 7 — Reservation Engine COMPLETE through 7.6 (Employee Management, Reservation Core, Approval Workflow, Lifecycle, Phone & Walk-In, Waitlist, Operational Signals) — all live-verified and production-verified (final closure 2026-07-24). Phase 8 — WebSocket IMPLEMENTED, live-verified through Nginx, and E2E verification-closed (2026-07-25, see TASKS.md). Phase 9 — Notifications COMPLETE · LIVE VERIFIED · STRICT-E2E VERIFIED · NOT PRODUCTION VERIFIED (OneSignal external credentials deferred). See TASKS.md for authoritative checklists.**

Prior narrative detail (Phases 3–7.4) retained below for continuity; for 7.5/7.6 and Phase 8 implementation detail see TASKS.md.

**Historical status prose (through Phase 7.3 framing; superseded for current ordering by the Status line above):** Phase 3 complete, fully verified — Phase 4 complete, fully verified (Restaurant CRUD, Restaurant Settings, Working Hours, Gallery, and Cuisine & Occasion Taxonomy Assignment all complete, live-verified) — Phase 5 COMPLETE (Branch CRUD, Working Schedule, Geo Coordinates, and Address all complete, live-verified; Maps frozen by architectural decision, not a backend responsibility) — Phase 6.1 (Table Module: Floor Plan & Table CRUD), Phase 6.2 (Move Table), and Status Management all complete, live-verified; Merge Tables and Split Tables are deferred until the Reservation Engine architecture has been approved and frozen (not cancelled - see TASKS.md's "Phase 6 — Merge/Split Tables Deferral" decision note) — Phase 7.0 (Employee Management) complete, live-verified; Phase 7.1 (Reservation Core) is now COMPLETE, live-verified, and production-verified (2026-07-20, see TASKS.md's "Phase 7.1 — Reservation Core" report and its "ADR-013 compliance fix" note) - Search Availability, Create Reservation, and the ADR-013 concurrency mechanism are fully implemented and tested; auto-approval/Approve/Reject/`Table.reserve()`/`TableStatus.Reserved` are deferred to Phase 7.2 by an approved Scope Amendment — **Phase 7.2 (Approval Workflow) is now COMPLETE, LIVE VERIFIED, and PRODUCTION VERIFIED** (2026-07-23, see TASKS.md's "Phase 7.2 — Approval Workflow" report) - Approve (`Table.reserve()`, auto-rejection of overlapping Pending reservations), Reject (no Table operation, per the approved Architecture Correction), and the auto-approval branch of Create Reservation are all implemented and tested end-to-end, including a corrected application of ADR-013's advisory lock to Approval-time concurrency, not only Create — **Phase 7.3 (Reservation Lifecycle) is now COMPLETE, LIVE VERIFIED, and PRODUCTION VERIFIED** (2026-07-23, see TASKS.md's "Phase 7.3 — Reservation Lifecycle" report and ADR-023): Cancel, Reschedule (including table-changing reschedule within the same Branch, with a deterministic two-key locking protocol per ADR-023, proven against real `pg_advisory_xact_lock` calls), Complete, No-Show, and the Expiration job (live-verified against real BullMQ/Redis) are all implemented and tested at every tier**

---

# Phase Numbering

**TASKS.md is the single authoritative source for phase numbers, checklists, and completion status.**

This document narrates the *goals, features, and exit criteria* behind each phase for context, but the phase numbers, names, and order below are kept identical to TASKS.md at all times — if the two ever disagree, TASKS.md wins and this document must be corrected to match. Do not renumber phases here independently of TASKS.md.

---

# Vision

Build the most scalable and maintainable restaurant reservation SaaS platform capable of serving:

* Millions of users
* Thousands of restaurants
* Multiple countries
* Multiple languages
* Multiple currencies

The platform must be production-ready from day one and follow enterprise engineering practices.

---

# Development Principles

* Architecture First
* Security First
* Performance First
* Testability
* Maintainability
* Scalability
* Clean Code
* Documentation Driven Development

---

# Current Progress

Phase numbers below match TASKS.md exactly.

| Phase | Name                     | Status       | Progress |
| ----- | ------------------------ | ------------ | -------- |
| 0     | Architecture Finalization| ✅ Completed | 100%     |
| 1     | Infrastructure           | ✅ Completed | 100%     |
| 2     | Authentication           | ✅ Completed | 100%     |
| 3     | User Module              | ✅ Completed | 100%     |
| 4     | Restaurant Module        | ✅ Completed | 100%     |
| 5     | Branch Module            | ✅ Completed | 100%     |
| 6     | Table Module             | ✅ Completed | 100%     |
| 7     | Reservation Engine       | ✅ Completed | 100%     |
| 8     | WebSocket                | ✅ Completed | 100%     |
| 9     | Notification System      | 🟢 Complete, live + strict-E2E verified (not production-verified) | ~95% |
| 10    | Reviews                  | ✅ Completed | 100%     |
| 11    | Offers                   | ✅ Completed | 100%     |
| 12    | Subscription System      | ✅ Completed (ADR-027, architecture frozen and implemented 2026-07-28) | 100%     |
| 13    | Payments                 | ❌ Removed from product scope (Owner Decision, 2026-07-28) — not implemented, not planned | N/A |
| 14    | Analytics                | ✅ Completed (ADR-028, architecture frozen and implemented 2026-07-28) | 100%     |
| 15    | Optimization             | ✅ Complete   | 100%     |
| 16    | Testing                  | ⏳ Pending    | 0%       |
| 17    | Deployment               | ⏳ Pending    | 0%       |
| 18    | Menu Management           | ✅ Completed (ADR-031, 2026-08-02; corrected by ADR-032, 2026-08-03; implemented 2026-08-03; verified and documentation-reconciled 2026-08-10) | 100%     |
| 19    | Platform Back Office       | 🟢 Phase 19.1 (ADR-034 subset) implemented 2026-08-04; Phase 19.2 (ADR-033, Customer Acquisition & Pricing) implemented 2026-08-09; Phase 19.3 (ADR-034 §2, Audit Log Read API) implemented 2026-08-10; Phase 19.4 (Organization Delete/Restore) implemented 2026-08-10; Phase 19.5 (Dashboard composition endpoint) implemented 2026-08-11; Phase 19.6 (Notification delivery-status aggregation, Dashboard Messaging section) implemented 2026-08-11; Phase 19.7 (narrow lookup/search + Organization self-service Change-Role/Remove/Transfer) implemented 2026-08-11; Phase 19.8 (Owner Invite, ADR-036) implemented 2026-08-12; Phase 19.9 (Internal Notification System extension, ADR-037 — Platform Admin/Restaurant Owner authoring, no Firebase/OneSignal) implemented 2026-08-12 | ~98%     |

**Correction (2026-08-04):** rows 10 (Reviews), 12 (Subscription System), and 14 (Analytics) above previously showed stale statuses ("Pending"/"Architecture frozen, not implemented") from before these phases were actually completed; corrected to match `TASKS.md` and `README.md`, which have been authoritative on their real status since 2026-07-28. Rows 18 and 19 were previously absent from this table entirely — added for completeness. Per the Phase Numbering rule above, `TASKS.md` remains authoritative if this table ever drifts again.

**Correction (2026-08-10):** row 18 (Menu Management) previously showed "Architecture frozen... not implemented" although the full implementation had shipped in commit `e4a5efc` on 2026-08-03 — a Phase 18 Provenance Audit found this status, along with `TASKS.md`'s Phase 18 checklist and the ADR-031/ADR-032 status lines in `DECISIONS.md`, had never been updated after implementation. Corrected here to match the verified state; see `TASKS.md`'s "Phase 18 — Menu Management: Reconciliation & Completion Report" for the full evidence trail.

Phase 6 is now COMPLETE: Merge Tables / Split Tables (architecture-frozen ADR-026, 2026-07-25) are implemented and live-verified (2026-07-26) — see TASKS.md's "Phase 6 — Merge/Split Implementation & Verification Report". Phase 8 is implemented, live-verified, and E2E verification-closed (2026-07-25) — see TASKS.md's Phase 8 Implementation & Verification Report and its Verification Closure Addendum. Phase 11 (Offers) is now COMPLETE and LIVE VERIFIED (2026-07-28 — architecture frozen and implemented the same day) — see TASKS.md's "Phase 11 — Offers: Pre-implementation architecture decisions" and "Phase 11 — Offers: Implementation & Verification Report". A phase-independent Customer Restaurant Discovery & Public Read Surface (public restaurant/branch/floor-plan/table-topology browsing, plus Customer own-reservation read endpoints) was implemented and live-verified the same day — see TASKS.md's "Customer Restaurant Discovery & Public Read Surface — Implementation & Verification Report".

---

# Phase 0 — Architecture Finalization

## Goals

* Define architecture, domain model, database schema, API conventions, coding standards
* Resolve the tenant/organization model, isolation mechanism, reservation concurrency mechanism, GDPR strategy, and WebSocket scaling mechanism via ADRs
* Produce a fully consistent documentation set before any code is written

### Deliverables

* Architecture Review Report
* ADR-011 through ADR-015 in DECISIONS.md
* Updated ARCHITECTURE.md, DOMAIN_MODEL.md, DATABASE_SCHEMA.md, API_GUIDELINES.md, CODING_STANDARDS.md, EVENTS.md, NON_FUNCTIONAL_REQUIREMENTS.md
* New: TENANCY.md, TESTING_STRATEGY.md, ENVIRONMENT_SETUP.md, LOCALIZATION.md

Exit Criteria

* Documentation consistent across all files
* User approval to begin Phase 1

---

# Phase 1 — Infrastructure

## Goals

* NestJS setup
* Prisma
* PostgreSQL
* Redis
* BullMQ
* Docker
* Docker Compose
* Nginx
* Logging
* Environment configuration
* Health checks

Exit Criteria

* Project runs locally
* Containers healthy

Status: Sub-phase 1.1 (Foundation) and Sub-phase 1.2 (Runtime Infrastructure) are both complete — see TASKS.md for the full checklist. The stack runs via `docker compose up` (PostgreSQL 17, Redis 7, MinIO, backend, Nginx), verified healthy in a live smoke test, including `/api/v1/health`, `/api/v1/metrics`, and `/api/v1/docs` all reachable directly and through Nginx. One deliberate addition beyond what this phase originally scoped: a single Prisma model, `SystemConfiguration` (already approved in DATABASE_SCHEMA.md), was added because Prisma does not generate a usable client for a schema with zero models — it is infrastructure, not a business entity. Only the Seed System item remains, deferred until a business entity needs default data.

---

# Phase 2 — Authentication & Authorization

**Update (2026-07-22, ADR-022, Phase 2.23 — COMPLETE, LIVE VERIFIED, PRODUCTION VERIFIED, see `TASKS.md`):** the "email verification" goal below reflects Phase 2.0's original scope, historically accurate for what was built. It has been superseded: customer registration is now phone-first (mobile Country Code Picker defaults to Syria +963, customer may select any other supported country, backend normalizes to canonical E.164 per ADR-022 Decision #13; WhatsApp OTP via LightOTP per ADR-024, no email), and Restaurant Owner accounts are provisioned administratively by an isolated-JWT-pipeline Platform Admin actor (no verification step for either). Public Owner self-registration and email verification are retired. See `AUTHENTICATION_ARCHITECTURE.md` §15 and `DECISIONS.md` ADR-022 for the authoritative current model.

**Update (2026-07-23, ADR-024 — COMPLETE, see `TASKS.md`):** the Customer OTP delivery provider was migrated from Fonnte to LightOTP. Only ADR-022's "Fonnte Integration Boundary" subsection is superseded; every other Customer/Owner authentication decision above is unaffected.

## Goals

* Registration, login, logout, refresh tokens, email verification, password reset
* Device session management; session version (logout-all); token families (replay detection)
* JWT access tokens + opaque refresh token rotation
* Authorization foundation: RBAC, PermissionResolver, Policy Engine, scope guards
* Tenant context integration (ADR-012, TENANCY.md)

## Architecture (Phase 2.0 + 2.0.1 — complete)

* **AUTHENTICATION_ARCHITECTURE.md** — identity, sessions, JWT, token families, session version
* **AUTHORIZATION_ARCHITECTURE.md** — RBAC, policies, guards, scope resolution, future ABAC
* **ADR-016** — Authentication & Session Strategy
* **ADR-017** — Authorization Strategy

## Governance (Phase 2.0.2 — complete)

Architecture frozen before first business migration:

* **ARCHITECTURE_LOCK.md** — locked ADRs, documents, and structural decisions
* **CHANGE_POLICY.md** — ADR triggers, documentation updates, code review
* **MIGRATION_POLICY.md** — Prisma migration rules and Phase 2.1 scope
* **VERSIONING.md** — SemVer, API `/api/v1`, token versioning
* **RELEASE_POLICY.md** — release workflow and environment gates
* **BRANCHING_STRATEGY.md** — trunk-based Git workflow, Conventional Commits

## Features (Phase 2.1 — complete)

* Prisma schema + migration for auth, authz, and tenant foundation tables
* Foundation seed (SystemConfiguration, Roles, Permissions)
* Database integration tests

## Features (Phase 2.2 — complete)

* Framework-independent authentication & authorization domain layer
* Value objects, entities, repository ports, domain services, events, exceptions
* Unit tests for core invariants

## Features (Phase 2.3 — complete)

* Application layer foundation (shared ports: Clock, UnitOfWork, EventPublisher, IdGenerator)

## Features (Phase 2.4 — complete)

* Security infrastructure (Argon2PasswordHasher, JwtTokenService, Sha256OpaqueTokenService, env validation)

## Features (Phase 2.5 — complete)

* `RegisterOrganizationOwnerUseCase` (application layer only; not yet exposed via HTTP)

## Features (Phase 2.6 — complete)

* `VerifyEmailUseCase` (application + infrastructure + `POST /api/v1/auth/verify-email`)
* Prisma repositories, UnitOfWork, event publishing after commit
* Unit, integration, repository, and E2E tests for verification flows

## Features (Phase 2.7 — complete)

* `LoginUseCase` (application + infrastructure + `POST /api/v1/auth/login`)
* DeviceSession + TokenFamily creation, opaque refresh token hashing, JWT access tokens
* LoginAttempt persistence, lockout policy, session cap enforcement
* Unit, integration, repository, controller, and E2E tests

## Features (Phase 2.8 — complete)

* `RefreshSessionUseCase` (application + infrastructure + `POST /api/v1/auth/refresh`)
* Opaque refresh-token rotation with PostgreSQL compare-and-swap (`rotateRefreshTokenIfHashMatches`)
* Replay detection via `previousRefreshTokenHash`; token-family compromise + security events
* 30s concurrent-refresh grace window (race loser → generic invalid, no family compromise)
* Unit, integration (including concurrency), controller, and E2E tests

## Features (Phase 2.9 — complete)

* `LogoutCurrentSessionUseCase`, `LogoutAllDevicesUseCase`, `ListActiveSessionsUseCase`, `RevokeSessionUseCase`
* Protected endpoints: `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`
* `JwtAuthGuard` + `SessionVersionGuard` + `@CurrentActor` decorator
* Atomic `sessionVersion` increment for logout-all; `REFRESH_CONCURRENT_GRACE_MS` moved to typed auth config
* Unit, integration, controller, guard, and E2E tests

## Features (Phase 2.10 — complete)

* `POST /auth/forgot-password` — account-enumeration-safe reset request
* `POST /auth/reset-password` — single-use opaque token consumption, password history, session revocation
* `PasswordResetRepository` + `PasswordHistoryRepository` Prisma adapters
* Atomic `consumeIfActive` CAS for reset tokens
* Events: `PasswordResetRequested`, `PasswordResetCompleted`, `SessionRevoked`

## Features (Phase 2.11 — complete)

* `POST /auth/change-password` — authenticated password change with CAS persistence
* Preserves current session; revokes other `DeviceSession`s and `TokenFamily`s
* Password history, reset-token invalidation, `sessionVersion` increment
* Events: `PasswordChanged`, `SessionRevoked` (other sessions)

## Phase 2.8–2.11 — Live PostgreSQL Verification

**Status:** ✅ EXECUTED 2026-07-07 against Docker `tavla_test` (`localhost:5433`). Integration + E2E verify suites passed. Details in `TASKS.md`.

## Phase 2.12 — Authentication Hardening + Live Database Verification

**Status:** ✅ COMPLETE (2026-07-11) — live gates for 2.8–2.11 passed; PostgreSQL transaction rollback injection and performance smoke tests done (2026-07-10). This session closed the three remaining critical blockers: `User.email` now has a database-level unique constraint with a CAS-safe registration path (proven under real concurrent load), `Organization`/`OrganizationMember`/`UserConsent` now have real Prisma-backed repositories (no in-memory stand-ins left on the Registration persistence path), and change-password now returns a fresh access token so the calling client's session doesn't go stale. `ForgotPasswordUseCase` timing-equalization was also added. Two non-blocking items remain open (unit coverage on 3 use-cases; `REQUIRE_LIVE_DATABASE` e2e verify mode hangs) — tracked in `TASKS.md`, not gating Phase 2.13.

## Phase 2.13 — TenantContextInterceptor Integration

**Status:** ✅ COMPLETE (2026-07-11) — `AsyncLocalStorage`-backed `TenantContextService` + globally-registered `TenantContextInterceptor` (TENANCY.md, ADR-012), plus a Prisma Client Extension enforcing fail-closed tenant scoping on the direct-column tenant-owned models (`OrganizationMember`, `Restaurant`), proven against real Postgres: cross-tenant read/write/create blocking, spoofed-`organizationId` rejection, transaction propagation, rollback, and concurrent Tenant A/B isolation. Relation-path models (`Branch`/`Employee`/`EmployeeBranchAssignment`) are identified but deliberately deferred to the phase that builds their first repository. Full details, scoping decisions, and a real AsyncLocalStorage/lazy-promise bug found and fixed during development are in `TASKS.md`.

## Phase 2.13.1 — Tenant Enforcement Wiring Closure

**Status:** ✅ COMPLETE (2026-07-11) — closes the gap a fresh audit found in Phase 2.13: the tenant-scoping extension existed and was proven correct in isolation, but no live repository actually used it. `PrismaContext` (the client every repository injects) now builds and transacts through the tenant-scoped client itself, so scoping is transparent for every existing repository and survives `PrismaUnitOfWork` transactions — required because a Prisma Client Extension's hooks can only propagate into `$transaction`'s `tx` when the transaction is started from an already-extended client. One documented exception (`PrismaLoginOrganizationReader`, a pre-tenant-identity self-lookup) and one bootstrap fix (self-registration binds tenant identity from the organization it just created, via the existing `TenantContextService.runAsync`) round out the wiring. An ESLint rule now blocks accidental raw-`PrismaService` injection in tenant-owned repositories. Proven against real Postgres with 5 new repository-level tests plus the existing suite, including strict (`REQUIRE_LIVE_DATABASE=true`) integration and E2E runs. Full details in `TASKS.md`.

## Phase 2.14 — PermissionResolver + Permissions in JWT

**Status:** ✅ COMPLETE (2026-07-11) — the Phase 2.2 domain `PermissionResolver` (a pure `(RoleGrant ∪ IndividualGrant) − IndividualRevocation` formula) had no application/infrastructure wiring until this phase: new `PrismaEmployeeRepository`/`PrismaRolePermissionRepository` (authorization module's first infrastructure layer) and `RbacPermissionResolver` (its first application layer) resolve an authenticated user's Employee-linked RBAC permissions from real Postgres. `LoginUseCase`/`RefreshSessionUseCase` now embed the correct JWT claim shape (`User` / `Employee` / `OrganizationMember`, per AUTHENTICATION_ARCHITECTURE.md §5.2) via a new shared `AccessTokenClaimsBuilder`, with Employee > OrganizationMember > User precedence when a user holds more than one role simultaneously. `JwtAuthGuard` now accepts all three actor types (previously hard-rejected anything but `User`, which would have locked out every Organization Owner's existing session-management calls the moment claims started varying). Proven against real Postgres: 3 new integration tests plus 12 new unit tests; full pre-existing Authentication/Tenancy suite re-run with zero regressions. Full details, tenant-isolation classification, and the precedence decision's rationale are in `TASKS.md`.

## Phase 2.15 — @RequirePermission + PermissionsGuard

**Status:** ✅ COMPLETE (2026-07-11) — route-level enforcement of the permissions Phase 2.14 resolves and embeds in the JWT. `@RequirePermission(slug)` (singular-permission metadata decorator) and `PermissionsGuard` (applied selectively via `@UseGuards`, never a global `APP_GUARD` — matching `JwtAuthGuard`/`SessionVersionGuard` convention) form the authorization module's first presentation layer. Fails closed on missing metadata and on actor types with no resolved `permissions` array (`User`, `OrganizationMember` — RBAC is Employee-only); exact-match only, no substring/case/wildcard matching. No production route needed protecting yet (no business module exists), so the guard is proven through a dedicated e2e-only fixture module. Found and fixed a real pre-existing bug while testing a genuinely expired signed JWT: `JwtTokenService` was discarding `jsonwebtoken`'s `TokenExpiredError` instead of attaching it as the exception `cause`, causing every real expired token to be misreported as a generic invalid token. Proven against real Postgres/Redis: 16 new e2e tests covering the full required scenario checklist (tampering, forged body/header permissions, cross-tenant isolation, refresh re-resolution, logout-all invalidation), plus 15 new unit tests. Full details in `TASKS.md`.

## Phase 2.16 — Redis-Backed Rate Limiting

**Status:** ✅ COMPLETE (2026-07-12) — atomic, Redis-backed sliding-window rate limiting (AUTHENTICATION_ARCHITECTURE.md §8.2/§8.3) on `login` (10/15min/IP), `refresh` (30/min/token hash), `forgot-password` (3/hour/email), and `reset-password` (10/15min/IP, reusing `login`'s numbers — no explicit architecture number exists for it, but §12.1 requires rate limiting as a reset-token brute-force mitigation). Implemented as a sliding-window-log via a single atomic Redis Lua script (ZSET-based), reusing the existing `REDIS_CACHE_CLIENT` connection with no new Redis client. `@RateLimit(policy)` + `RateLimitGuard` mirror the `@RequirePermission`/`PermissionsGuard` shape exactly. A pre-implementation audit found Phase 2.17 (brute-force lockout + LoginAttempt persistence) was already fully implemented in `LoginUseCase`/`User` despite being checked incomplete — a documentation-staleness fix, not new code. Proven against real Postgres/Redis: 7 new integration tests (including a two-independent-Redis-clients horizontal-scaling proof) and 9 new e2e tests (including a two-independent-NestJS-instances horizontal-scaling proof), plus 19 new unit tests, 100% coverage on every new file except the Redis adapter itself (integration-tested instead, matching this codebase's existing Prisma/Redis adapter convention). Full details in `TASKS.md`.

## Phase 2.18 — Authentication Audit Log Writes

**Status:** ✅ COMPLETE (2026-07-12) — persistent audit logging for security-sensitive authentication actions, backed by a new `AuditLog` table matching DATABASE_SCHEMA.md's already-documented schema exactly (no new columns invented). `AuditingEventPublisher` decorates the existing `LoggingEventPublisher` and is now bound to `EVENT_PUBLISHER`, implementing EVENTS.md's "all security events write to AuditLogs" rule for every use case that already publishes a domain event (Register, Verify Email, Login, Refresh, Refresh Replay, Logout, Logout All, Session Revoked, Forgot Password, Password Reset, Password Change) with zero changes to any use case's success path. Direct writer calls cover the actions with no domain event today (login failure/lockout, invalid/expired JWT, permission denied, rate limit exceeded) — deliberately not wiring any new domain event publishing, which is Phase 2.19's scope. `organizationId` is preserved via `TenantContextService` when bound, `null` otherwise (accurate for pre-authentication actions); `AuditLog` is intentionally excluded from fail-closed tenant-scoping enforcement so those writes keep working. Every write fails open (caught, logged, never rethrown) so an audit outage can never break a login/logout/permission-check. Proven against real Postgres: 18 new e2e tests (one per required security-test scenario, plus a no-secrets-in-any-row sweep) and 4 new integration tests, plus ~45 new/updated unit tests, 100% coverage on every new file except the Prisma adapter itself (integration-tested instead, matching this codebase's existing convention). Full details in `TASKS.md`.

## Phase 2.19 — Domain Event Publishing

**Status:** ✅ COMPLETE (2026-07-12) — a full audit of every domain event class defined in `authentication.events.ts` found all 12 already correctly published (exactly once, after commit, never from a controller/repository, never before rollback — proven directly this phase by asserting zero events collected in all 6 existing rollback-injection scenarios plus a new Login rollback test). The one genuine gap: `AccountLocked`, documented in EVENTS.md with a real implemented trigger (`LoginUseCase`'s failed-login lockout) but never published as a domain event — Phase 2.18 had only a direct audit write standing in for it. `AccountLockedEvent` now exists and flows through the existing `AuditingEventPublisher`, and the redundant direct write was retired (same resulting audit action string, so no observable regression). Eight other EVENTS.md-documented security events (`BruteForceDetected`, `SuspiciousLoginDetected`, `PermissionEscalationDetected`, etc.) were deliberately left unwired — each requires functionality (device fingerprinting, admin unlock, permission granting, a security aggregator) that doesn't exist yet, or would require publishing a "domain event" from a guard with no transaction/aggregate behind it, violating the established architecture. Full reasoning and the complete event inventory are in `TASKS.md`.

## Phase 2.20 — Owner Registration HTTP Flow

**Status:** ✅ COMPLETE (2026-07-12) — `POST /auth/register` now exposes the existing, application-layer-only `RegisterOrganizationOwnerUseCase` (Phase 2.5) per AUTHENTICATION_ARCHITECTURE.md §9.2's documented contract. No business logic changed: this phase closed two pure DI-wiring gaps the use case had carried since Phase 2.5/2.13.1 (no `@Injectable()`/`@Inject()` annotations at all, and `TENANT_CONTEXT_PORT` defined but never bound) and built out `OrganizationsModule` from its empty scaffold. Request/response DTOs match the documented contract exactly - `intent` is narrowed to `'owner'` only (no customer-registration use case exists to route `'customer'` to; rejected with a standard validation error rather than silently ignored), and the response deliberately excludes `organizationId`/`organizationSlug`/`organizationName` (not part of the documented contract, even though the Application-layer result carries them). Zero new exception-mapping or audit code was needed - `GlobalExceptionFilter` and `AuditingEventPublisher`'s existing `UserRegisteredEvent` → `auth.register.success` mapping (Phase 2.18) both already covered every case. The `register` rate-limit policy (5/hour/IP) reuses the exact `RateLimitGuard` mechanism Phase 2.16 built and explicitly deferred to this phase. Proven end-to-end for the first time over real HTTP: tenant bootstrap, transaction rollback on duplicate email/slug (no orphaned rows), audit generation, and domain event publishing. 13 new e2e tests, 12 new/updated unit tests, zero regressions across the full Authentication/Authorization/Tenancy/Rate-limiting/Audit/Events suite. Full details in `TASKS.md`.

## Phase 2.21 — Swagger Completion + API Error Codes

**Status:** ✅ COMPLETE (2026-07-12) — documentation-only phase: every `AuthController` endpoint (all 11 routes) gained an explicit `operationId`, a `description` separate from its `summary`, and its full, exception-verified set of documented HTTP statuses (adding a previously-undocumented `404` on `verify-email` and `403` on `refresh`/`change-password`/`logout`/`logout-all`/`sessions` GET/`sessions/:id` DELETE, all reachable via `SessionVersionGuard` or `UserNotFoundException` but not previously listed). A new reusable `ApiErrorResponse` decorator plus a shared `ErrorResponseDto` schema now document the exact application `code` string(s) each status can carry, referencing `API_GUIDELINES.md`'s Error Codes list. That list itself had three already-implemented codes missing (`CONFLICT`, `AUTH_TOO_MANY_SESSIONS`, `AUTH_SESSION_NOT_FOUND`) and a duplicated pair of lines — corrected to match the live implementation rather than changing any exception's `code` (a behavior change, out of this phase's scope). Two DTO precision gaps fixed: `LoginRequestDto`/`RegisterRequestDto.email` now has `@IsNotEmpty()`, and `LoginResponseDto.organization` (always present, nullable) now uses `@ApiProperty({ nullable: true })` instead of `@ApiPropertyOptional`. A new `auth.controller.swagger.spec.ts` boots the real `SwaggerModule.createDocument` against just `AuthController` (no DB/Redis) and asserts the document builds, every endpoint appears, there are no duplicate `operationId`s or unnamed schemas, and bearer auth appears only on the 5 session-guarded routes — so this stays enforced on every future change instead of being a one-off check. Zero runtime behavior changed: all 248 pre-existing unit tests pass unmodified, plus 6 new ones. Full details in `TASKS.md`.

## Phase 2.22 — Security Test Suite + Load Smoke

**Status:** ✅ COMPLETE (2026-07-12) — Phase 2's closing security audit and load-smoke gate. Audited Phases 2.4-2.21's actual code (not just prior completion reports): a mechanical sweep of the entire backend found zero TODO/FIXME/HACK markers, zero `@ts-ignore`, zero `eslint-disable`, zero unflagged tenant-scoping bypasses, zero vacuous tests, zero unflagged silent-swallow catches; an Authorization/Tenancy audit confirmed `PermissionsGuard` fails closed with exact-match-only comparisons, no long-lived permission cache exists anywhere, and the tenant-scoped Prisma extension's `organizationId` always wins over client-supplied values (proven twice, including an explicit spoofing-attempt test). One genuine gap found and fixed: `POST /auth/change-password` had no rate limit at all, letting a holder of a stolen-but-valid access token brute-force the real password with unlimited wrong-`currentPassword` guesses - closed by reusing the existing `RateLimitGuard` mechanism (same precedent Phase 2.16/2.20 set), keyed by authenticated `userId`, 10/15min. Added regression tests proving the pre-existing timing-equalization/account-enumeration-resistance behavior in `LoginUseCase`/`ForgotPasswordUseCase` (previously unprotected by any test). Brought up the full Docker stack, discovering and fixing a genuine pre-existing credential mismatch (Redis running with the dev password against an already-`tavla_test` Postgres) that had been causing ioredis to hang in an infinite `WRONGPASS` retry loop; the `backend` service's own Docker image was separately found broken (`Cannot find module 'express'`, a build-pipeline issue `ENVIRONMENT_SETUP.md` already flags as a known risk class) and is tracked as a remaining risk, not fixed this phase (out of scope, and not needed for Jest-based verification). New `load-smoke.e2e-spec.ts` proves the app survives concurrent bursts (health checks, logins, registrations) against real Postgres/Redis with no failures and no cross-account data bleed - deliberately not a full Load Test (TESTING_STRATEGY.md explicitly defers throughput/SLO validation to ahead of Phase 15, run against staging). Full verification against real infrastructure: 252/252 unit, 70/70 strict integration, 93/93 strict E2E. Phase 2 is complete by the architecture's own exit criteria; Authentication is feature-complete but not yet production-ready (Load Testing, monitoring/alerting, backup verification, and the broken Docker image remain open per NON_FUNCTIONAL_REQUIREMENTS.md's Definition of Production Ready). Full details in `TASKS.md`.

## Post-Phase-2 Production Readiness Fix — Backend Docker Image

**Status:** ✅ COMPLETE (2026-07-13) — closes the one open gap Phase 2.22 flagged: the `backend` Docker production image was crash-looping on `Cannot find module 'express'`. Root cause: `main.ts` (and `test-app.factory.ts`) import `express` by value for body-parser limits, but `express` was never a direct dependency of `apps/backend/package.json` — only reachable transitively through `@nestjs/platform-express`/`swagger-ui-express`. Under pnpm's strict `node_modules`, a phantom transitive dependency is invisible to the requiring package's own resolution; this reproduces identically outside Docker (`node dist/main.js`), which is also why Jest's E2E/integration suites never caught it (Jest's own resolver is more lenient than Node's real CJS resolution). Fixed by adding `express` as an explicit direct dependency (matching the version already pinned by `@nestjs/platform-express`) and regenerating the lockfile — no Dockerfile or architecture change. A second, previously-masked defect surfaced once fixed: `docker-compose.yml`'s `backend` service never passed through the already-documented (`ENVIRONMENT_SETUP.md`) Authentication env vars (`JWT_*`, `ARGON2_*`); added the missing pass-throughs. Verified end-to-end: clean image rebuild, full stack (`postgres`/`redis`/`minio`/`backend`/`nginx`) healthy with 0 restarts, live HTTP smoke test (health/readiness/liveness/metrics/Swagger all green, Postgres/Redis/MinIO all "up"), a real `POST /auth/register` against the running container, and the complete regression suite re-run clean (typecheck, lint, build, 252/252 unit, 70/70 integration, 70/70 **strict** integration against a dedicated `tavla_test` stack, 93/93 E2E, 93/93 **strict** E2E, Prisma format/validate/generate/migrate/seed, `pnpm audit` clean). Full details, including two disclosed pre-existing/unrelated findings (a test-harness strict-mode gap and an order-dependent rate-limit test flake), in `TASKS.md`.

## Post-Phase-2 Test Infrastructure Hardening

**Status:** ✅ COMPLETE (2026-07-13) — follow-up to the Post-Phase-2 Docker Fix above, closing three defects that fix's own report disclosed: strict verification (`test:integration:verify`/`test:e2e:verify`) wasn't reliably fail-closed, because `REQUIRE_LIVE_DATABASE=true` was set only inside a Jest `setupFiles` entry, which runs after (and in a different process from) `globalSetup` — the only code path that actually enforces it — and because 14 of 15 infrastructure-gated spec files used their own local reachability check instead of the shared helper, silently skipping regardless of strict mode. Fixed with a small cross-platform Node launcher (`apps/backend/scripts/run-strict-tests.js`, no new dependency, uses Jest's own programmatic API) that sets the required env before Jest even starts, and by standardizing all 14 files (plus a Redis equivalent in `redis-rate-limiter.integration-spec.ts`) onto the shared `isDatabaseReachable`/`isRedisReachable`/`skipUnlessDatabaseAvailable` helpers. Proven both directions: with no test database reachable, both `:verify` commands exit non-zero with a clear error and no manual shell export; against a live, migrated, seeded `tavla_test` stack, both pass for real (17/17 integration, 13/13 E2E) — and Postgres was deliberately stopped and restarted mid-session to directly demonstrate fail-closed-then-fail-open behavior, not just assume it. Separately root-caused and fixed the pre-existing order-dependent flake in `rate-limit.e2e-spec.ts`: its `createAndLoginUser` helper omitted the `X-Forwarded-For` header every other test in the file sets, so its login calls landed in the shared real-loopback-IP bucket other E2E files (and prior runs) also touch; fixed with a unique fake IP per call, a test-only change with zero production rate-limiting code touched. Proven with 5 consecutive isolated runs (11/11 each) plus two full strict-suite runs with different file ordering (13/13, 93/93 both). `ENVIRONMENT_SETUP.md`'s in-container Prisma migration command was confirmed genuinely incompatible with the minimal production image and corrected to the already-documented host-based workflow; a new local-only credential/volume-drift recovery note was added, explicitly labeled destructive. Full details in `TASKS.md`.

## Features (Phase 3+ — pending)

* BranchScopeGuard / OrganizationMemberGuard / PlatformAdminGuard
* Domain policies + PolicyEngine runtime (authorization)

Exit Criteria

Authentication fully tested (unit + integration + E2E per TESTING_STRATEGY.md).

---

# Phase 3 — User Module

**Status:** ✅ Fully Verified — User Profile sub-scope (`GET`/`PATCH /api/v1/users/me`) is ✅ **COMPLETE** (2026-07-14), explicitly approved and delivered: `User.updateProfile()`, `GetCurrentUserProfileUseCase`/`UpdateUserProfileUseCase`, `UsersController`, full unit/integration/E2E coverage (including **strict** live-infrastructure verification), and a Docker-verified `register → verify-email → login → GET → PATCH → GET` flow. Full details in TASKS.md's "Phase 3.1 — User Module: User Profile" report. Avatar Upload sub-scope (`POST /api/v1/users/me/avatar`) is also ✅ **COMPLETE** (2026-07-14): a reused `Files`/MinIO storage path (public bucket, server-generated object keys, magic-byte-validated JPEG/PNG/WebP, replace-then-cleanup semantics), full unit/integration/E2E coverage against real PostgreSQL + MinIO, and a Docker-verified upload/fetch/replace flow with byte-identical content confirmed via SHA-256. Full details in TASKS.md's "Phase 3.2 — User Module: Avatar Upload" report. Favorites sub-scope (`POST`/`DELETE /api/v1/users/me/favorites/:restaurantId`, `GET /api/v1/users/me/favorites`) is also ✅ **COMPLETE** (2026-07-14): a `FavoriteRestaurant` User child entity, a minimal cross-tenant `RestaurantDirectoryReaderPort` (required because customers carry no `organizationId` and `Restaurant` is tenant-scoped), idempotent add/remove backed by the database's own unique constraint, full unit/integration/E2E coverage including **strict** live-infrastructure verification against a corrected, genuinely separate test stack, and a Docker-verified add/list/remove/isolation/IDOR flow. Full details in TASKS.md's "Phase 3.3 — User Module: Favorites" report. Preferences sub-scope (`GET`/`PATCH /api/v1/users/me/preferences`) is **implemented and fully live-verified** (2026-07-15): `notificationOptIn`/`marketingOptIn` added directly to the existing `User` aggregate (not a new `UserPreference` entity — an explicit, user-directed architecture decision that also corrected a pre-existing documentation inconsistency between `DATABASE_SCHEMA.md`/`DOMAIN_MODEL.md` and the already-shipped Phase 3.1 schema), `GetCurrentUserPreferencesUseCase`/`UpdateUserPreferencesUseCase`, full unit coverage, and a full live-infrastructure verification pass: migrations applied/status-checked/replayed-from-zero, non-strict **and** strict integration (86/86 tests, both stacks) and E2E (161/161 tests, both stacks), Docker health/Nginx, and a manual HTTP flow (register → verify → login → profile → preferences → persistence → cross-user isolation → stale-session rejection). Live verification found one real, pre-existing, platform-wide defect unrelated to Preferences' own logic — the global `ValidationPipe`'s implicit type conversion was silently coercing any non-empty string to `true` for every `@IsBoolean()`-decorated field (also `RegisterConsentsRequestDto`, Phase 2) — which was fixed in a dedicated follow-up session (`enableImplicitConversion` removed from `validation-pipe.factory.ts`; `ListFavoritesQueryDto`'s pagination switched to explicit `@Type(() => Number)`) and re-verified with zero regressions. Full details in TASKS.md's "Phase 3.4 — User Module: Preferences", "Phase 3.4 Live Verification", and "Phase 3.4.1 Global Boolean Validation Fix" reports. Devices and the GDPR export/anonymization workflow below remain `⏳ Pending` and unapproved. **Phase 3 is fully verified with zero known defects; Phase 4 has not been started.**

## Features

* Customer profiles ✅ (User Profile fields: `firstName`, `lastName`, `phone`, `language`, `preferredCurrency`)
* Profile image ✅ (Avatar Upload — `POST /api/v1/users/me/avatar`)
* Favorites ✅ (`POST`/`DELETE /api/v1/users/me/favorites/:restaurantId`, `GET /api/v1/users/me/favorites`)
* Devices
* Preferences ✅ (`GET`/`PATCH /api/v1/users/me/preferences` — `notificationOptIn`/`marketingOptIn`; fully live-verified, zero known defects)
* GDPR export/anonymization workflow (ADR-014)

---

# Phase 4 — Restaurant Module

**Status:** ✅ **COMPLETE** — all five sub-scopes implemented and live-verified. Restaurant CRUD sub-scope (`POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants`, `GET /api/v1/restaurants/:id`) is ✅ **COMPLETE and live-verified** (2026-07-16): the pre-existing `Restaurant` foundation table (built ahead of time in Phase 2.1, already registered in the tenant-scoping Prisma extension) required no schema/migration change; a new `OrganizationMemberGuard`/`@RequireOrgRole()` (the first real implementation of AUTHORIZATION_ARCHITECTURE.md's already-locked organization-administrative authorization layer) scopes every route to `OrganizationMember` Owner/Admin actors, deliberately never combined with Employee RBAC (`PermissionsGuard`) on the same route; full unit/integration/E2E coverage including **strict** live-infrastructure verification against two separate stacks, Docker health, and a manual HTTP flow through Nginx proving tenant isolation and IDOR protection against two real organizations. Full details in TASKS.md's "Phase 4.1 — Restaurant Module: Restaurant CRUD" report. Restaurant Settings sub-scope (`GET`/`PATCH /api/v1/restaurants/:id/settings`) is also ✅ **COMPLETE and live-verified** (2026-07-16): a new `RestaurantSettings` 1:1 child entity (reservation interval/capacity/cancellation window/pending-timeout/auto-approval/timezone/default currency) auto-created with defaults alongside every new `Restaurant`, one additive Prisma migration, no tenant-scoping extension change (gated transitively through the already tenant-scoped `RestaurantRepository`, matching the `Favorite`/`PrismaEmployeeRepository` precedent), the same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization reused unchanged, full unit/integration/E2E coverage including **strict** live-infrastructure verification against two separate stacks, Docker health, and a manual HTTP flow through Nginx. Full details in TASKS.md's "Phase 4.2 — Restaurant Module: Restaurant Settings" report. Working Hours sub-scope (`GET`/`PATCH /api/v1/restaurants/:id/working-hours`) is also ✅ **COMPLETE and live-verified** (2026-07-16), **Restaurant-level default only** — an explicit architecture decision resolving a documentation conflict found during pre-implementation review (DATABASE_SCHEMA.md documented a dual-parent Restaurant/Branch design; DOMAIN_MODEL.md's aggregate-ownership list placed `WorkingHours` under Restaurant only, and Branch is an unbuilt Phase-5 scaffold). Branch-level override is explicitly deferred to Phase 5. A new 1:many `WorkingHours` child entity (one row per day-of-week, `HH:mm` open/close/break times, cross-midnight hours explicitly allowed) with no auto-provisioned defaults (a fresh restaurant has zero rows until the owner configures them), one additive Prisma migration, no tenant-scoping extension change (same transitively-tenant-owned pattern as `RestaurantSettings`), the same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization reused unchanged, full unit/integration/E2E coverage including **strict** live-infrastructure verification against two separate stacks, Docker health, and a manual HTTP flow through Nginx. Full details in TASKS.md's "Phase 4.3 — Restaurant Module: Working Hours" report. Gallery sub-scope (`POST`/`GET /api/v1/restaurants/:id/gallery`, `DELETE /api/v1/restaurants/:id/gallery/:galleryItemId`) is also ✅ **COMPLETE and live-verified** (2026-07-16), **Restaurant-level only**, per six explicit user-approved architecture decisions: Restaurant-only ownership (no Branch), complete reuse of the existing Files module/MinIO public bucket (no second upload subsystem), a hard cap of 20 images per restaurant enforced in the application layer (no `SystemConfiguration`, no feature flag), append-only `sortOrder` (no reorder endpoint), and deletion that removes the gallery row, the `File` row, and the MinIO object together via the existing Files infrastructure. A new 1:many `RestaurantGallery` child entity, one additive Prisma migration, no tenant-scoping extension change (same transitively-tenant-owned pattern as `RestaurantSettings`/`WorkingHours`), the same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization reused unchanged, full unit/integration/E2E coverage including **strict** live-infrastructure verification against two separate stacks, Docker health, and a manual HTTP flow through Nginx (real multipart image upload, list, delete, audit-log confirmation). Full details in TASKS.md's "Phase 4.4 — Restaurant Module: Gallery" report. Cuisine & Occasion Taxonomy Assignment sub-scope (`GET`/`PATCH /api/v1/restaurants/:id/cuisine-categories`, `GET`/`PATCH /api/v1/restaurants/:id/occasion-categories`, plus public `GET /api/v1/cuisine-categories`/`GET /api/v1/occasion-categories`) is also ✅ **COMPLETE and live-verified** (2026-07-16), per ADR-018's already-documented taxonomy tables: `CuisineCategory`/`OccasionCategory` are platform-managed reference data seeded at deploy (not tenant-scoped, not created via any owner-facing API), linked to a restaurant via `RestaurantCuisineCategory`/`RestaurantOccasionCategory` join tables with full-replace `PATCH` semantics (matching Working Hours' established convention). Four new tables, one additive Prisma migration, no tenant-scoping extension change (same transitively-tenant-owned pattern as `RestaurantSettings`/`WorkingHours`/`RestaurantGallery`), the same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization reused unchanged for the restaurant-scoped assignment routes, and two new unauthenticated public routes for listing the reference catalog. Full unit/integration/E2E coverage including **strict** live-infrastructure verification against two separate stacks, Docker health, and a manual HTTP flow through Nginx (public listing, assignment, validation rejection, and cross-tenant IDOR protection all proven live). Full details in TASKS.md's "Phase 4.5 — Restaurant Module: Cuisine & Occasion Taxonomy Assignment" report. **All five Restaurant Module sub-scopes are now complete; Phase 4 is fully verified with zero known defects.**

## Features

* Organization creation (implicit during onboarding, ADR-011)
* Restaurant profiles ✅ (Restaurant CRUD — `POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants`, `GET /api/v1/restaurants/:id`; `OrganizationMember` Owner/Admin only)
* Restaurant reservation settings ✅ (Restaurant Settings — `GET`/`PATCH /api/v1/restaurants/:id/settings`; `OrganizationMember` Owner/Admin only)
* Restaurant-level working hours ✅ (`GET`/`PATCH /api/v1/restaurants/:id/working-hours`; `OrganizationMember` Owner/Admin only; branch-level override is Phase 5)
* Restaurant gallery ✅ (`POST`/`GET /api/v1/restaurants/:id/gallery`, `DELETE .../gallery/:galleryItemId`; `OrganizationMember` Owner/Admin only; max 20 images, reuses the Files module completely)
* Cuisine & Occasion Taxonomy Assignment ✅ (`GET`/`PATCH /api/v1/restaurants/:id/cuisine-categories`, `GET`/`PATCH /api/v1/restaurants/:id/occasion-categories`; `OrganizationMember` Owner/Admin only; plus public `GET /api/v1/cuisine-categories`/`GET /api/v1/occasion-categories`; ADR-018)
* Branches
* Employees
* Settings

---

# Phase 5 — Branch Module

**Status:** ✅ **COMPLETE** — Branch CRUD sub-scope (`POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants/:restaurantId/branches[/:branchId]`) is ✅ **COMPLETE and live-verified** (2026-07-16): uses the pre-existing `Branch` foundation table (built ahead of time in Phase 2.1) - no schema/migration change required. `Branch` carries no direct `organizationId` column, so it is not a `DIRECT_TENANT_OWNED_MODELS` entry in the tenant-scoping Prisma extension; every use case resolves the parent Restaurant via the already-tenant-scoped `RestaurantRepository` first (same relation-path pattern as Restaurant Settings/Working Hours), now crossing a module boundary since Branch is its own top-level feature module (`BranchesModule`, previously an empty scaffold) rather than a Restaurant child feature - `RestaurantsModule` now exports `RESTAURANT_REPOSITORY` for this purpose. The same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization is reused unchanged. City/district/address/countryCode/currency/timezone/phone are exposed by CRUD; opening hours remain out of this sub-scope (resolved separately by `BranchWorkingHours`, Phase 5.2). Full unit/integration/E2E coverage including **strict** live-infrastructure verification, Docker health, and a manual HTTP flow. Full details in TASKS.md's "Phase 5.1 — Branch Module: Branch CRUD" report. Working Schedule sub-scope (`GET`/`PATCH /api/v1/restaurants/:restaurantId/branches/:branchId/working-hours`) is also ✅ **COMPLETE and live-verified** (2026-07-16): a new `BranchWorkingHours` 1:many child entity of the Branch aggregate - a separate table from Restaurant's own `WorkingHours` (Phase 4.3), not a nullable `branchId` bolted onto it, resolving the branch-level override Phase 4.3 explicitly deferred to Phase 5. `BranchWorkingHours` carries no `organizationId`/`restaurantId` of its own; every use case resolves the parent Restaurant, then the parent Branch, via their already-tenant-scoped repositories first (two-hop relation-path tenancy). One additive Prisma migration, no tenant-scoping extension change, the same `OrganizationMemberGuard`/`@RequireOrgRole()` authorization reused unchanged, full-replace `PATCH` semantics identical to Restaurant's own Working Hours. Full unit/integration/E2E coverage including **strict** live-infrastructure verification against both the dev and isolated strict-verification databases, Docker health, and a manual HTTP flow. Full details in TASKS.md's "Phase 5.2 — Branch Module: Working Schedule" report. Geo Coordinates for Nearby Search sub-scope (ADR-018) is also ✅ **COMPLETE and live-verified** (2026-07-16): `latitude`/`longitude` (`Decimal(10,7)`, nullable, existing unused since Phase 2.1) are now exposed on Branch CRUD's own `POST`/`PATCH`, both-or-neither paired and range-validated (-90..90 / -180..180) at both the DTO and domain layers, plus a new composite `(latitude, longitude)` B-tree index (`GiST` explicitly deferred to Phase 15+ per DATABASE_SCHEMA.md's own note). The actual bounding-box "nearby restaurant" search query is out of scope - ADR-018 attributes that to a future, unscheduled Discovery module (Phase 15.5). No new migration beyond the index (the columns already existed), no new route, no new tenant/authorization surface - reuses Phase 5.1's Create/Update use cases verbatim. "Maps" and "Address" (the two remaining checklist items) were found to have zero concrete specification anywhere in the documentation during this sub-phase's pre-implementation review and were reported as STOP conditions rather than guessed at. Full unit/integration/E2E coverage including **strict** live-infrastructure verification, Docker health, and a manual HTTP flow. Full details in TASKS.md's "Phase 5.3 — Branch Module: Geo Coordinates for Nearby Search" report. Address is now ✅ **reclassified as complete** (documentation-only reconciliation, no new implementation): `PRODUCT_REQUIREMENTS.md` FR-04.2 requires only address/city/district/country/timezone/currency/geo coordinates, all already fully delivered by Phase 5.1 and Phase 5.3 - `DOMAIN_MODEL.md`'s `Address` Value Object is a generic, aggregate-unbound illustrative example, not a requirement bound to `Branch`, and must not be interpreted as requiring `postalCode`, a formal `Address` Value Object, or aggregate refactoring. Maps is now ❄️ **frozen by an approved architectural decision** (2026-07-16), closing out Phase 5: Maps is not a backend feature - backend responsibility ends at exposing accurate geographic coordinates (already delivered, Phase 5.3); rendering maps, provider selection, URL generation, and navigation are client responsibilities. No Maps module, entity, Value Object, provider port, adapter, schema change, or API change was made or is required. Reviewed against `CHANGE_POLICY.md`'s ADR-required criteria: none apply (it introduces no new external dependency - it explicitly declines to - and touches none of the other nine triggers), so no ADR was created for this decision. A future backend-specific map capability (server-side geocoding, provider integration, signed URLs) would require its own Product Requirement and ADR as an entirely new feature. **Phase 5 — Branch Module is now fully COMPLETE, fully verified, with zero known defects.**

## Features

* Branch CRUD ✅ (`POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants/:restaurantId/branches[/:branchId]`; `OrganizationMember` Owner/Admin only)
* Maps — ❄️ Frozen by architectural decision (not a backend responsibility); backend responsibility ends at geographic coordinates (see Geo Coordinates below); rendering/provider selection/navigation are client concerns
* Working schedules ✅ (`GET`/`PATCH /api/v1/restaurants/:restaurantId/branches/:branchId/working-hours`; `OrganizationMember` Owner/Admin only; branch-level override, separate from Restaurant's own default)
* Geo coordinates ✅ (`latitude`/`longitude` on Branch CRUD's own `POST`/`PATCH`; ADR-018; nearby-search query itself deferred to the future Discovery module, Phase 15.5)
* Address ✅ (fully satisfied by Branch CRUD's address/city/district/countryCode/timezone/currency, Phase 5.1, plus latitude/longitude, Phase 5.3 — reclassified complete, no `postalCode`/Value Object/aggregate refactoring required)
* Capacity settings

---

# Deferred Architectural Decisions

Capabilities considered and explicitly deferred, not currently scheduled on the roadmap. Each requires a new Product Requirement (and, where noted, a new ADR) before any future implementation phase may begin.

* **Maps (backend map-provider integration)** — deferred indefinitely (2026-07-16). Current backend responsibility ends at exposing accurate `latitude`/`longitude` (Branch CRUD, Phase 5.1/5.3). Rendering maps, selecting a map provider (Google Maps, Mapbox, OpenStreetMap, Apple Maps), generating map URLs, and navigation are client responsibilities. If a future requirement introduces genuine backend-specific map functionality (server-side geocoding, provider integration, static map generation, signed URLs), it must be proposed as a new feature with its own Product Requirement and ADR (mandatory per `CHANGE_POLICY.md` criterion 2, "introduces a new external dependency") - not resumed under the old Phase 5 checklist item.

---

# Phase 6 — Table Module

## Features

* CRUD ✅ (Phase 6.1 — Create/Update/Soft-Delete, see TASKS.md's "Phase 6.1 — Table Module: Floor Plan & Table CRUD" report)
* Drag positioning support ✅ (`positionX`/`positionY` fields exposed by Create/Update, Phase 6.1 — actual drag-and-drop UI is a client concern)
* Shapes ✅ (Phase 6.1 — intentionally minimal `TableShape` enum: `Rectangle`/`Round` only, presentation metadata with no business behavior; a square table is `Rectangle` with `width == height`)
* Floors / Floor Plans ✅ (Phase 6.1 — FloorPlan Create/List/Activate, one-active-per-branch Aggregate Invariant, atomic activation swap)
* Capacity ✅ (Phase 6.1)
* Move ✅ (Phase 6.2 — `POST /api/v1/tables/:tableId/move`, dedicated Domain Action reassigning only `floorPlanId` within the same Branch. **Phase 8 (implemented 2026-07-25):** Move publishes a real `TableMovedEvent` through `EVENT_PUBLISHER`; `table.moved` auditing flows through the normal event/audit-publisher path. See TASKS.md's Phase 8 Implementation & Verification Report / EVENTS.md Table Events.)
* Merge ✅ (ADR-026 — Primary Table model; architecture frozen 2026-07-25, **IMPLEMENTED, LIVE VERIFIED 2026-07-26**. `POST /api/v1/tables/merge`. See TASKS.md's "Phase 6 — Merge/Split Tables: Final architecture freeze" and "Phase 6 — Merge/Split Implementation & Verification Report". Historical deferral note retained in TASKS.md.)
* Split ✅ (ADR-026 — undo merge only; architecture frozen 2026-07-25, **IMPLEMENTED, LIVE VERIFIED 2026-07-26**. `POST /api/v1/tables/:tableId/split`. Same reports as Merge.)
* Status management ✅ (`TableStatus` = `Available`/`Occupied`/`Cleaning`/`Disabled`/`Reserved` — `Reserved` is Reservation-write-path only since Phase 7.2; single `POST /tables/{tableId}/status` Domain Action for Available↔Occupied/Cleaning/Disabled; restrictive state machine. **Phase 8 (implemented 2026-07-25):** manual status transitions publish `TableStatusChangedEvent` (Option A — narrow); Reservation `reserve()`/`release()` still do not emit that event. See TASKS.md's Phase 8 Implementation & Verification Report.)

---

# Phase 7 — Reservation Engine

Status: ✅ **COMPLETE** through Phase 7.6 (2026-07-24). Phase 7.0 (Employee Management), 7.1 (Reservation Core), 7.2 (Approval Workflow), 7.3 (Reservation Lifecycle / ADR-023), 7.4 (Phone & Walk-In / ReservationGuest), 7.5 (Reservation Waitlist / ADR-019), and 7.6 (Operational Signals: ReminderDue / LateArrival / TableReady + ReminderQueue / LateArrivalQueue) are all COMPLETE, LIVE VERIFIED, and PRODUCTION VERIFIED. See TASKS.md for each sub-phase report. Deferred outside Phase 7: no-show banning; broader GDPR/erasure. Merge/Split Tables (ADR-026) is a Phase 6 deliverable, outside Phase 7 implementation scope — implemented and live-verified 2026-07-26 (see TASKS.md's Phase 6 Merge/Split Implementation & Verification Report). Phase 9 notification delivery shipped (OneSignal external production verification deferred separately).

## Features

* Reservation requests
* Approval workflow
* Phone / Walk-In reservations (`ReservationGuest`)
* Waitlist (FIFO ordered-first-serviceable promotion)
* Rescheduling (incl. same-branch table change, ADR-023)
* Cancellation / Completion / Expiration / No-show
* Conflict prevention (ADR-013 advisory lock + exclusion constraint)
* Operational signals (ReminderDue, LateArrival, TableReady — domain/event side; delivery is Phase 9)

---

# Phase 8 — WebSocket

Status: 🟢 **Implemented, live-verified, and E2E verification-closed (2026-07-25).** Full freeze decisions in TASKS.md "Phase 8 — WebSocket: Pre-implementation architecture decisions"; implementation/verification evidence in TASKS.md's Phase 8 Implementation & Verification Report and its Verification Closure Addendum. EVENTS.md WebSocket section synchronized.

## Features

* Socket.IO gateway (`RealtimeGateway`) behind existing Redis Adapter (ADR-015) — already wired (`RedisIoAdapter`), now with a `close()` override fixing a discovered connection leak on shutdown
* `RealtimeEventPublisher` outermost `EVENT_PUBLISHER` decorator + `RealtimeBroadcasterPort` (best-effort fan-out; never fails committed business ops) — live-verified through Nginx
* Live Reservations / Live Tables / Live operational signals ("Live Notifications" = fan-out of existing domain/ops signals — **not** Phase 9 Notification subsystem)
* Typed `room.subscribe` / `room.unsubscribe`; rooms: organization / restaurant / branch / reservation
* Handshake authentication implemented as Socket.IO connection middleware (not the `OnGatewayConnection` lifecycle hook) to close a genuine race discovered during e2e testing; disconnect-at-JWT-exp; scope/ownership room authz (no new realtime permission slugs)
* New domain events: `TableStatusChangedEvent` (manual status only), `TableMovedEvent` — both implemented, published through `EVENT_PUBLISHER`
* No Prisma migration, no new external dependency (confirmed — `prisma migrate status` clean against the real dev database)
* E2E coverage: all 8 allow-listed representative flows (`ReservationApproved`/`Cancelled`/`Rescheduled`/`NoShow`, `WaitlistEntryPromoted`, `TableReadyNotified`, `TableStatusChanged`, `TableMoved`) each have a dedicated real REST→WebSocket E2E round trip — see TASKS.md's Phase 8 Verification Closure Addendum

---

# Phase 9 — Notification System

Status: 🟢 **Complete, live verified, strict-E2E verified — NOT production-verified (2026-07-25).** Owner explicitly authorized implementation following the architecture freeze. Full frozen decisions in `TASKS.md`'s "Phase 9 — Notification System: Pre-implementation architecture decisions"; built exactly as frozen. Static/unit/integration/E2E verification passed; both Docker stacks rebuilt and force-recreated; live HTTP/WebSocket/BullMQ verification against the rebuilt dev stack passed (see TASKS.md's Phase 9 implementation note). A dedicated closure session (2026-07-25) additionally executed the strict-stack E2E suite (34 suites / 377 tests, PASS) and a full regression re-run (all gates green) — see TASKS.md's "Final Production Verification & Closure addendum". **ADR-025 Identity-Verification JWT delivery** was owner-approved (hybrid: login/refresh field + `GET /notifications/identity-token`) and implemented the same day. **One production-relevant item remains open:** external OneSignal delivery is BLOCKED — no live credentials (`ONESIGNAL_APP_ID`/`ONESIGNAL_API_KEY`/`ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY`) and no real recipient. Email removed from scope (2026-07-25 product decision) — not a planned notification delivery channel.

## Features

* OneSignal (`external_id = User.id`; ES256 Identity Verification adopted, ADR-025)
* In-App (durable `Notification` record; Phase 8 WebSocket is a best-effort realtime hint only, never a substitute)
* Provider abstraction (`NotificationProvider`, ADR-007 Anti-Corruption Layer)
* Notification templates / localization (see LOCALIZATION.md) — platform-global, unversioned in v1
* Recipient scope: registered `User`/Customer only in v1 — no Employee/OrganizationMember inbox, no `ReservationGuest` recipient
* Delivery ownership split: Phase 7.6 `ReminderQueue`/`LateArrivalQueue` schedule; a new `NotificationQueue` delivers

---

# Phase 10 — Reviews

Status: ✅ **COMPLETE, LIVE VERIFIED, AND PRODUCTION VERIFIED (2026-07-27).** Full implementation report in `TASKS.md`'s "Phase 10 — Reviews." Delivered exactly the frozen scope: authenticated-Customer-owned only (guest reservations not review-eligible); rating mandatory integer 1–5, comment optional; Reviews immutable after creation (no edit endpoint - confirmed live); soft delete by the owning Customer or the Restaurant's Organization Owner/Admin (not Employees); zero-or-one `RestaurantReply` by Organization Owner/Admin only (no Employee reply, no new permission slug); Review images reuse the existing Files/MinIO pipeline (`FileOwnerType.Review`, max 5 per review, live-verified against real MinIO); `Restaurant.averageRating` recomputed transactionally, no BullMQ queue; tenancy transitive via `Review.restaurantId → Restaurant.organizationId` (no `organizationId` column); excluded from Phase 8 realtime and Phase 9 notifications; no moderation subsystem. A real lost-update race in the `averageRating` recompute under concurrent Review submissions was found during live concurrency verification and fixed (`RestaurantRepository.lockForRatingRecompute`, acquired before the triggering Review insert/delete) - see TASKS.md for the full root-cause analysis and proof.

## Features

* Ratings
* Comments
* Images
* Restaurant replies

---

# Phase 11 — Offers

Status: ✅ **COMPLETE, LIVE VERIFIED** (2026-07-28 — architecture frozen and implemented the same day). Single generic `Offer` aggregate with a `type` discriminator (`Promotion | Coupon | Event`) — not three separate aggregates. Coupons are display-only in v1 (no redemption engine). Owner/Admin-only management, no new Employee permission slug. Restaurant-scoped public read only (`GET /api/v1/discovery/restaurants/:restaurantId/offers`), no platform-wide discovery endpoint. Excluded from Phase 8 realtime and Phase 9 notifications in v1 (Phase 9 impact: none; Phase 8 impact: none). Automatic BullMQ expiration live-verified against real Redis. See `TASKS.md`'s "Phase 11 — Offers: Pre-implementation architecture decisions" and "Phase 11 — Offers: Implementation & Verification Report" for the full detail.

## Features

* Coupons ✅
* Promotions ✅
* Events ✅

**Happy Hour is explicitly out of scope for Phase 11** (this bullet previously appeared here but not in `TASKS.md`'s authoritative checklist — reconciled 2026-07-28; no recurring/day-of-week/time-of-day schedule concept exists in the frozen `Offer` model).

---

# Phase 12 — Subscription System

**COMPLETE. LIVE VERIFIED (2026-07-28).** Architecture frozen 2026-07-28 (ADR-027) — entitlement/access contract, not billing — implemented and live-verified the same day. See `TASKS.md`'s "Phase 12 — Subscription System" sections (architecture decisions + implementation) and `DECISIONS.md` ADR-027 for the full design and implementation-time reconciliations.

## Features

* Plans (persisted, seeded, platform-global reference data — no dynamic PlatformAdmin authoring in this phase)
* Organization-level plan ownership (ADR-011), with `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant` enforced per-Restaurant, not as an Organization-wide total (ADR-027)
* Usage Tracking (`SubscriptionUsage` Organization-scoped, new `RestaurantUsage` Restaurant-scoped)

**Explicitly excluded:** no reservation-volume limit (`maxMonthlyReservations`) — a restaurant must never lose booking capability by successfully doing business; no billing/payment/checkout of any kind (see Phase 13).

---

# Phase 13 — Payments

**REMOVED FROM PRODUCT SCOPE (Owner Decision, 2026-07-28).** Payments were removed from TAVLA product scope before Phase 13 implementation began. TAVLA does not process customer or reservation payments inside the platform — no checkout, deposits, pre-authorization, payment gateway integration, transaction ledger, or invoicing (ADR-021, withdrawn — see `DECISIONS.md`). Restaurants may handle financial settlement independently, outside TAVLA. See `TASKS.md` Phase 13 for the full disposition. This phase number is retained as a historical tombstone; it is not reassigned.

---

# Phase 14 — Analytics

**COMPLETE. LIVE VERIFIED (2026-07-28).** Architecture frozen 2026-07-28 (ADR-028) — operational restaurant analytics only, direct PostgreSQL reads, no new persistence — implemented and live-verified the same day. See `TASKS.md`'s Phase 14 section for the full metric/route register and Implementation & Verification Report, and `DECISIONS.md` ADR-028 for the architecture decision.

## Features

* Reservation reports (status counts, source breakdown, service-day trend, booking-created trend, completion/no-show/cancellation rate, average party size)
* Peak hours (reservation starts per 60-minute Branch-local hour bucket)
* Customer insights (unique/returning registered customers, guest-backed reservation count, average party size)
* Waitlist analytics (entry/outcome counts, closed-entry conversion rate)
* Review summary (active review count, average rating)

**Explicitly excluded from v1** (see ADR-028): occupancy percentage (exact or approximate), revenue/GMV/payment analytics, exports/scheduled reports, comparison periods, PlatformAdmin BI, ActivityFeed, WebSocket/realtime analytics, analytics notifications. "Revenue-ready reports" in prior roadmap drafts was stale wording predating the Payments removal (ADR-021 Disposition) — TAVLA does not process payments and Phase 14 has zero currency-denominated metrics.

---

# Phase 15 — Optimization

Status: ✅ **COMPLETE, LIVE VERIFIED, PRODUCTION VERIFIED** (2026-07-30). See `TASKS.md`'s "Phase 15 — Optimization: Pre-Implementation Audit Report", "Architecture Freeze Report", and "Implementation & Verification Report" for the full evidence trail.

## Goals

* Redis caching — evidence-backed review outcome: **not introduced** (no measured expensive read justified one; Redis's existing rate-limiting/queue/pub-sub roles unchanged)
* Query optimization — Reviews result-assembler N+1 and SearchAvailability redundant merge-group query both eliminated and batch-proven (unit + real-Postgres)
* Index tuning — one evidence-backed additive index, `Reservation(userId, createdAt)` (~260x measured improvement on the customer reservation-history query)
* Performance profiling — k6 adopted (ADR-029); Discovery/Reservation availability/Reservation creation/Analytics all measured live against the rebuilt production image, all within `NON_FUNCTIONAL_REQUIREMENTS.md` budgets

---

# Phase 15.5 — Discovery Module

Status: ✅ **COMPLETE, LIVE VERIFIED, PRODUCTION VERIFIED** (2026-07-30). See `TASKS.md`'s "Phase 15.5 — Discovery Module: Pre-Implementation Architecture Decision Note" for the full, authoritative decision record (D1–D17), and its "Phase 15.5 — Discovery Module: Implementation & Verification Report" for the Docker-dependent verification evidence.

## Goals

* Restaurant text search (`ILIKE` on `Restaurant.name` only, v1)
* Nearby restaurant search (bounding-box + Haversine on existing Branch geo columns/index, no PostGIS/GiST)
* Cuisine/occasion taxonomy filtering (relational taxonomy, not the legacy `cuisineType` string)
* Price-level and minimum-rating filtering
* Deterministic sorting (name/rating/newest; distance for nearby)
* Restaurant comparison (stateless, 2–5 restaurants, ADR-018)
* `hasActiveOffer` result annotation
* Public Discovery rate limiting (closes a pre-existing gap on the already-shipped Discovery browsing routes)
* Customer-safe FloorPlan/Table projection correction (security fix to the already-shipped floor-plan endpoint)

Explicitly out of v1: reservation availability filtering, Menu, external search engines/extensions, Redis caching, personalized/sponsored ranking, favorites integration.

---

# Phase 15.6 — Messaging Module

Status: ✅ **COMPLETE, LIVE VERIFIED, PRODUCTION VERIFIED** (2026-08-02). See `TASKS.md`'s "Phase 15.6 — Messaging Module: Implementation & Verification Report" for the full evidence trail, and `DECISIONS.md` ADR-020/ADR-030 (plus ADR-020's "Phase 15.6 Messaging — Owner Decisions" note, D1–D15) for the architecture decisions.

## Goals

* Customer–restaurant in-app conversations, tenant-resolved transitively via `restaurantId → Restaurant.organizationId` (ADR-030, no direct `organizationId` column)
* Per-person read receipts, `Closed` (staff, both sides) vs. `Archived` (customer, self only) with auto-reopen on a new message
* Dual Actor authorization for the Restaurant side (Employee `conversations:manage` + branch scope, or OrganizationMember Owner/Admin) — same use-case-branching pattern as Tables Merge/Split (ADR-026) and Analytics (ADR-028)
* Realtime delivery via a new `conversation:{id}` room (fifth `RoomType`, Phase 8's own anticipated extension point)
* Customer-only notification on a staff reply — never the reverse, never staff
* Inline image attachments (JPEG/PNG/WebP, reusing the existing Files/MinIO pipeline, private bucket)
* Cursor (keyset) pagination — a deliberate new convention for this phase's message/conversation lists only
* Per-participant rate limiting and `Idempotency-Key` support on `SendMessage`/`StartConversation`

Explicitly out of v1: GDPR erasure job/endpoint (schema field only), virus scanning on attachments, document/PDF attachments.

---

# Phase 16 — Testing

## Coverage

* Unit tests
* Integration tests
* End-to-end tests

Minimum target coverage: **90%** (see TESTING_STRATEGY.md)

---

# Phase 17 — Deployment

## Deliverables

* Docker images
* Production compose
* Nginx
* CI/CD readiness
* Monitoring
* Logging
* Backup strategy

---

# Phase 18 — Menu Management

**Architecture frozen 2026-08-02 (see DECISIONS.md ADR-031); ownership/availability/isFeatured corrected 2026-08-03 (ADR-032); implementation not yet authorized.**

## Goals

* One or more Menus per Restaurant, containing Categories, containing Menu Items — exactly one Menu per Restaurant is `isDefault` (**corrected by ADR-032** from the original singleton design)
* Configurable per-item Option Groups (with Options) and Add-ons
* Always/Unavailable/Scheduled item availability, with Scheduled backed by a relational `MenuItemAvailability` table (**corrected by ADR-032** from a `scheduleJson` column)
* Per-item `isFeatured` highlighting flag (**added by ADR-032**)
* Reuse of existing File/MinIO infrastructure for Category/Item images (no new upload system)

## Deliverables

* `Menu`, `MenuCategory`, `MenuItem`, `MenuItemOptionGroup`, `MenuItemOption`, `MenuItemAddOn`, `MenuItemAvailability` Prisma models
* Owner/Admin management API (CRUD + reorder + availability-window replace + set-default) and Customer public read API
* `menu:manage` permission slug
* Discovery `hasMenu` boolean (no search, no indexing, no recommendation engine)

Explicitly out of Phase 18: Reservations/Reviews/Offers/Messaging/Analytics/Notifications/Realtime integration (Offer→MenuItem reference documented for a future phase only, not implemented); `MenuItem.sku` explicitly evaluated and deferred pending a future POS/Inventory/ERP integration ADR (ADR-032).

---

# Phase 19 — Platform Back Office

**Architecture frozen 2026-08-04 (DECISIONS.md ADR-033/ADR-034/ADR-035). Phase 19.1 — a curated subset of ADR-034 — implemented 2026-08-04**: Platform Roles/RBAC (`PlatformAdmin`/`PlatformSupport`), Platform Admin account CRUD, Restaurant Suspend/Reactivate/Delete/Restore, Organization Suspend/Reactivate/Emergency Ownership Transfer, and Account access control (Force Logout/Reset Credentials/Disable/Enable Login). **Phase 19.2 — the full ADR-033 checklist — implemented 2026-08-09**: Customer Acquisition & Pricing Engine (acquisition-on-approval, Reversal, Manual Recording, Pricing Rule Activation/Simulation, Revenue Reporting, Export). **Phase 19.3 — the Audit Log Read API (ADR-034 §2) — implemented 2026-08-10**: `AuditLogReaderPort` + `PrismaAuditLogReader` (ADR-035 Pattern 2), `GET /platform-admin/audit-logs`, filterable by actorId/targetType/targetId/action/organizationId, required/bounded date range. **Phase 19.4 — Organization Delete/Restore (ADR-034 §4) — implemented 2026-08-10**: mirrors Restaurant Delete/Restore exactly (soft delete via the existing `Organization.deletedAt` field, no new schema; no cascade to Restaurant/Branch/Employee/Reservation data, ever). **Phase 19.5 — Platform Dashboard composition endpoint — implemented 2026-08-11**: `GET /platform-admin/dashboard` (ADR-035 Pattern 2), parallelized `Promise.all` reads composing Restaurant/Organization/Subscription (current-state counts) and Acquisition/Revenue (time-series, reuses Phase 19.2's exact reader). Messaging deliberately excluded — no cross-tenant Notification read capability existed yet, disclosed as a dependency rather than built. **Phase 19.6 — Notification delivery-status aggregation — implemented 2026-08-11**: closes that dependency. A platform-wide `pushStatus` `groupBy` (ADR-035 Pattern 2 — `Notification` carries no `organizationId` at all) integrated into the same Dashboard endpoint as a fifth, current-state Messaging section; no standalone endpoint. **Phase 19.7 — narrow per-entity lookup/search + Organization self-service member management — implemented 2026-08-11**: `GET /platform-admin/restaurants`/`organizations` (new), `GET /platform-admin/acquisitions/:id` (new), `GET /platform-admin/pricing/rules` label/id filters (extends existing) — no unified search endpoint. `GET/PATCH/DELETE/POST /organizations/members*` (Change Role/Remove/Transfer Ownership, Owner/Admin self-service, ADR-034 §7 previously deferred) — reuses `OrganizationMembershipPolicy.transferOwnership` and the existing `OrganizationMemberGuard`/`@RequireOrgRole` pattern verbatim. **Phase 19.8 — Owner Invite (ADR-036) — implemented 2026-08-12**: resolves the Phase 19.7 gap. A dedicated `OrganizationInvitation` entity (Option B, explicit acceptance-required invitation lifecycle) — `OrganizationMember.userId` remains required/non-nullable, untouched. `POST/GET/DELETE /organizations/invitations*` (issue/list/revoke, Owner/Admin) + public, token-authenticated `POST /invitations/:token/accept` (creates a new User+OrganizationMember atomically, or an OrganizationMember only for an already-registered invitee). New `EmailProviderPort` Anti-Corruption Layer + generic-SMTP `SmtpEmailProvider` adapter. **Phase 19.9 — Internal Notification System extension (ADR-037) — implemented 2026-08-12**: Platform Admin → one Customer (`POST /platform-admin/notifications`) and Platform Admin/Restaurant Owner → all eligible Customers broadcast (`POST /platform-admin/notifications/broadcast`, `POST /restaurants/:restaurantId/notifications/broadcast`), processed asynchronously in batches via a new `NotificationBroadcast` table + BullMQ job on the existing `NotificationQueue`. New self-only `user:{userId}` Socket.IO room for realtime delivery. Internal only — **no Firebase, OneSignal, FCM, or APNs**; the existing OneSignal Push track (Phase 9) is untouched. See TASKS.md's Phase 19 section for the full checklist and all Implementation/Engineering Reports.

**Not yet authorized/implemented**: the BullMQ-async branch of Export for date ranges exceeding the synchronous Heavy-Operations budget.

---

# Milestones

* Architecture Finalized (Phase 0 — Completed)
* Infrastructure Operational (Phase 1 — Sub-phases 1.1/1.2 Completed; full Docker Compose stack verified healthy)
* Authentication Complete
* Reservation Engine Complete
* Real-time System Operational
* Notification System Operational
* Beta Release
* Release Candidate
* Production Release

---

# Definition of Done

A feature is complete only if:

* Architecture approved
* Code implemented
* Tests written
* Documentation updated
* Security reviewed
* No critical lint issues
* No duplicated logic
* API documented
* Code reviewed
* Ready for production
