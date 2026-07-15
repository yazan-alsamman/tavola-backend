# 🍽️ TAVLA

> **Enterprise Restaurant Reservation Platform**

TAVLA is a production-grade, enterprise-level SaaS platform that enables restaurants to manage reservations, tables, branches, employees, menus, offers, subscriptions, and analytics through a centralized backend.

The platform is designed to serve **thousands of restaurants**, **millions of users**, and support **multiple countries, languages, and currencies**.

---

# Project Status

Current Stage

> ✅ Phase 2.22 (Security Test Suite + Load Smoke) — **COMPLETE**. Phase 2 exit criteria met. Post-Phase-2 Docker production-image fix and Post-Phase-2 Test Infrastructure Hardening also complete — the `backend` image builds, starts, and passes health checks cleanly, and `test:integration:verify`/`test:e2e:verify` are now genuinely fail-closed with no order-dependent flakes (a leftover port-mismatch in `test/support/verify-env.json` was found and fixed during Phase 3.3). Phase 3 was explicitly approved; all four sub-scopes, **User Profile** (`GET`/`PATCH /api/v1/users/me`), **Avatar Upload** (`POST /api/v1/users/me/avatar`), **Favorites** (`POST`/`DELETE /api/v1/users/me/favorites/:restaurantId`, `GET /api/v1/users/me/favorites`), and **Preferences** (`GET`/`PATCH /api/v1/users/me/preferences`), are now implemented and **fully live-verified** against real Docker/PostgreSQL/Redis/MinIO (both the dev stack and the isolated strict-verification stack), including a full manual HTTP flow through Nginx — see TASKS.md's "Phase 3.1", "Phase 3.2", "Phase 3.3", "Phase 3.4 — User Module: Preferences", "Phase 3.4 Live Verification", and "Phase 3.4.1 Global Boolean Validation Fix" reports. Live verification found one real, pre-existing, platform-wide defect unrelated to Preferences' own logic — the global `ValidationPipe`'s implicit type conversion was silently coercing any non-empty string to `true` for every `@IsBoolean()`-decorated field (`UpdateUserPreferencesRequestDto` and, pre-existing, `RegisterConsentsRequestDto` from Phase 2) — which was fixed in a dedicated follow-up session (removed the global `enableImplicitConversion` flag; the one legitimate consumer of implicit numeric conversion, `ListFavoritesQueryDto`'s pagination, now uses explicit `@Type(() => Number)` instead) and re-verified with zero regressions. **Phase 3 — User Module is now fully verified, with zero known defects.** Phase 4 — Restaurant Module was explicitly approved and its first three sub-scopes are now complete: **Restaurant CRUD** (`POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants`, `GET /api/v1/restaurants/:id`, see TASKS.md's "Phase 4.1" report), **Restaurant Settings** (`GET`/`PATCH /api/v1/restaurants/:id/settings`, see TASKS.md's "Phase 4.2" report), and **Working Hours** (`GET`/`PATCH /api/v1/restaurants/:id/working-hours`, Restaurant-level default only - branch-level override explicitly deferred to Phase 5, see TASKS.md's "Phase 4.3" report), all implemented and live-verified end-to-end (unit, non-strict and strict integration/E2E against two separate stacks, Docker, and a manual HTTP flow through Nginx). Restaurant management is scoped exclusively to `OrganizationMember` (Owner/Admin) actors via `OrganizationMemberGuard`/`@RequireOrgRole()` - the first real implementation of AUTHORIZATION_ARCHITECTURE.md's already-locked organization-administrative authorization layer, reused unchanged for Settings and Working Hours. Restaurant CRUD required no schema/migration change; Restaurant Settings and Working Hours each required one additive migration (`restaurant_settings` and `working_hours` child tables respectively; `working_hours` rows are created only when the owner explicitly configures them, with no auto-provisioned defaults). The remaining Phase 4 sub-scopes (Gallery, Taxonomy) have not been started.

Registration (`POST /auth/register`, restaurant owner + Organization bootstrap), login, refresh, logout, session management, forgot/reset/change password are all implemented end-to-end, with Redis-backed sliding-window rate limiting on register/login/refresh/forgot-password/reset-password/change-password, a persistent audit trail for every security-sensitive authentication action, and every applicable domain event (Registered, Verified, LoggedIn/Out, SessionRevoked, Refreshed, Replay/Family-Compromise detection, PasswordChanged/Reset/ResetRequested, AccountLocked) published exactly once, after commit. Phase 2.22 closed out Phase 2 with a security audit (fixing one real gap — `change-password` previously had no rate limit) and a load-smoke test proving the app survives concurrent bursts against real infrastructure without failures.

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