# ARCHITECTURE_LOCK.md

# Enterprise Restaurant Reservation Platform

Version: 1.0  
**Lock effective:** 2026-07-07  
**Status:** ACTIVE — architecture frozen pending explicit unlock

---

# Purpose

This document records which architectural decisions are **locked** before Phase 2.1 (the first business database migration). Locked decisions may not be changed through implementation shortcuts, refactors, or undocumented deviations.

Changes to locked decisions require the process defined in **CHANGE_POLICY.md** (typically a new ADR, documentation update, and explicit approval).

---

# Lock Scope

The following phases are **complete and locked**:

| Phase | Scope | Lock date |
|---|---|---|
| Phase 0 | Architecture finalization | 2026-07-07 |
| Phase 0.5 | Architecture baseline (blueprint) | 2026-07-07 |
| Phase 1 | Infrastructure (NestJS, Docker, Prisma scaffold, observability) | 2026-07-07 |
| Phase 2.0 | Authentication architecture | 2026-07-07 |
| Phase 2.0.1 | Authorization architecture | 2026-07-07 |
| Phase 2.0.2 | Architecture governance (this document and companion policies) | 2026-07-07 |

Phase 2.1 (Prisma migrations) may **implement** locked architecture but must **not alter** it without unlock.

---

# Locked Architecture Decision Records (ADRs)

All ADRs with status **Accepted** in `DECISIONS.md` are locked:

| ADR | Title | Locked decision (summary) |
|---|---|---|
| ADR-001 | Clean Architecture & Modular Monolith | Layer separation; microservice-ready monolith |
| ADR-002 | NestJS as API Framework | NestJS for HTTP, WebSocket, DI |
| ADR-003 | Prisma as ORM | Prisma + migrations; repository pattern mandatory |
| ADR-004 | Redis for Caching, Sessions, Queues | Single Redis deployment; logical separation |
| ADR-005 | BullMQ for Background Jobs | Async work via BullMQ only |
| ADR-006 | MinIO for Object Storage | S3-compatible file storage |
| ADR-007 | PostgreSQL as Primary Database | PostgreSQL 17+ |
| ADR-008 | Argon2 for Password Hashing | Argon2id for credentials |
| ADR-009 | Multi-Tenant Logical Isolation | Row-level isolation (superseded in mechanism by ADR-011/012; principle retained) |
| ADR-010 | Soft Delete Policy | `deletedAt` on applicable entities |
| ADR-011 | Organization as Tenant Boundary | `organizationId` is outermost tenant scope |
| ADR-012 | Prisma Client Extension for Tenant Isolation | Automatic `organizationId` scoping via async context |
| ADR-013 | Reservation Concurrency Control | Advisory lock + exclusion constraint |
| ADR-014 | GDPR Anonymization Strategy | Anonymize-in-place; no hard delete of User row |
| ADR-015 | Socket.IO Redis Adapter | Horizontal WebSocket fan-out via Redis |
| ADR-016 | Authentication & Session Strategy | Identity, JWT, opaque refresh rotation, email verification gate |
| ADR-017 | Authorization Strategy | Auth/authz separation; Policy Engine; PermissionResolver |

**Post-lock extensions (Architecture Compliance Audit 2026-07-07):**

| ADR | Title | Summary |
|---|---|---|
| ADR-018 | Search & Restaurant Discovery | PostgreSQL-first search; optional search engine at scale |
| ADR-019 | Waitlist & Operational Signals | Waitlist aggregate; reminders; late arrival; table ready |
| ADR-020 | Customer–Restaurant Messaging | Conversation/Message schema; WebSocket delivery |
| ADR-021 | Billing Invoices | Invoice documents linked to payments |

These ADRs extend `DATABASE_SCHEMA.md` and `DOMAIN_MODEL.md` without breaking locked ADR-001–017 decisions.

---

# Locked Architecture Documents

The following documents are the **authoritative specification** for locked concerns. Implementation must conform; contradictions are bugs in code, not in docs.

| Document | Locked content |
|---|---|
| `ARCHITECTURE.md` | Layers, modules, data flow, scalability principles |
| `DOMAIN_MODEL.md` | Aggregates, entities, business rules, domain services, policies |
| `DATABASE_SCHEMA.md` | Table shapes, indexes, constraints, relationships |
| `TENANCY.md` | Tenant context propagation, Prisma extension, system-context escape hatch |
| `AUTHENTICATION_ARCHITECTURE.md` | Identity, sessions, JWT, token families, session version |
| `AUTHORIZATION_ARCHITECTURE.md` | RBAC, policies, guards, scope resolution, permission versioning |
| `API_GUIDELINES.md` | REST conventions, response envelope, error codes |
| `EVENTS.md` | Domain, auth, authz, security, WebSocket events |
| `CODING_STANDARDS.md` | Code structure, naming, layer rules |
| `TESTING_STRATEGY.md` | Test categories, coverage targets, CI expectations |
| `NON_FUNCTIONAL_REQUIREMENTS.md` | Performance, security, scalability targets |
| `LOCALIZATION.md` | Multi-language, currency, RTL/LTR |
| `ENVIRONMENT_SETUP.md` | Local/dev/staging/production configuration |

Governance documents (`ARCHITECTURE_LOCK.md`, `CHANGE_POLICY.md`, `MIGRATION_POLICY.md`, `VERSIONING.md`, `RELEASE_POLICY.md`, `BRANCHING_STRATEGY.md`) are also locked once Phase 2.0.2 is approved.

---

# Locked Structural Decisions

These are non-negotiable without a new ADR:

## Application structure

* **Clean Architecture** — Domain has zero framework dependencies.
* **Modular monolith** — Feature modules under `apps/backend/src/modules/`.
* **Repository pattern** — No Prisma calls from controllers or use cases.
* **Dependency injection** — NestJS DI; ports in Domain, adapters in Infrastructure.

## Multi-tenancy

* **Organization** is the tenant boundary (`organizationId`).
* **Prisma Client Extension** enforces tenant scoping — not manual `WHERE` clauses.
* **Branch/restaurant scope** is authorization, not tenancy.

## Authentication vs Authorization

| Concern | Module | Responsibility |
|---|---|---|
| Authentication | `modules/authentication/` | Identity, credentials, sessions, JWT, `JwtAuthGuard`, `SessionVersionGuard` |
| Authorization | `modules/authorization/` | RBAC, `PermissionResolver`, `PolicyEngine`, policies, scope guards |
| Tenancy | `infrastructure/tenancy/` | `organizationId` isolation |

Business logic must not embed permission checks; use cases invoke domain policies.

## Security primitives (locked)

* **Opaque refresh tokens** with rotation and `tokenFamilyId` replay detection.
* **`Users.sessionVersion`** for O(1) logout-all.
* **`permissionsVersion`** on User/Employee for permission staleness detection.
* **No `UserPermission` table** — employee overrides via `RolePermissions.employeeId`.
* **Argon2** password hashing; passwords never logged.
* **Email verification gate** before login.

## Data & concurrency

* **Soft delete** where specified in `DATABASE_SCHEMA.md`.
* **Reservation conflict control** — advisory lock + PostgreSQL exclusion constraint (`btree_gist`).
* **GDPR** — anonymization-in-place per ADR-014.

## Infrastructure stack (locked)

| Component | Technology |
|---|---|
| API | NestJS 11 |
| ORM | Prisma 6 |
| Database | PostgreSQL 17 |
| Cache / pub-sub / queues | Redis 7 |
| Background jobs | BullMQ |
| Object storage | MinIO |
| Reverse proxy | Nginx |
| Realtime | Socket.IO + Redis Adapter |

Replacing any stack component requires a new ADR.

---

# Locked API Contract

* Base path: `/api/v1` (see `VERSIONING.md`).
* Response envelope: `{ success, message, data, meta }` / error shape per `API_GUIDELINES.md`.
* Authentication error codes: `AUTH_*` prefix.
* Bearer JWT in `Authorization` header.

Breaking changes to the public API contract require a new API version (`/api/v2`) per `VERSIONING.md`.

---

# What Is NOT Locked

The following remain **open** and do not require unlock — only a new ADR when implementation begins:

| Topic | Status | Reference |
|---|---|---|
| Payment provider | Open ADR required | `DECISIONS.md` Future Decisions |
| Search engine | Open ADR required | Future Decisions |
| RS256 vs HS256 for JWT | Open | `AUTHORIZATION_ARCHITECTURE.md` Open Decisions |
| `Roles.parentRoleId` inheritance | Deferred | Phase 3+ |
| Redis permission cache | Deferred | Phase 3+ |
| `PermissionAssignments` table | Deferred | Phase 3+ |
| CI/CD pipeline | Open ADR required | Future Decisions |
| Feature flag evaluation mechanism | Open ADR required | Future Decisions |
| PostgreSQL RLS (defense-in-depth) | Deferred | ADR-012 alternatives |

Implementation details **within** locked boundaries (class names, file layout inside a module, test fixtures) are not locked unless they violate locked documents.

---

# Unlock Procedure

To change a locked decision:

1. **Propose** a new ADR in `DECISIONS.md` (do not edit accepted ADRs in place — supersede with a new ADR).
2. **Update** all affected architecture documents per `CHANGE_POLICY.md`.
3. **Review** — architecture review required; security-sensitive changes need explicit security review.
4. **Approve** — explicit approval before implementation (same gate as Phase 2.0).
5. **Migrate** — if database impact, follow `MIGRATION_POLICY.md`.
6. **Record** — update this document's lock table if scope changes.

Emergency production hotfixes that touch locked architecture still require a retrospective ADR within 48 hours.

---

# Phase 2.1 Gate

Phase 2.1 (first business Prisma migration) may begin only when:

- [x] Phase 2.0 Authentication architecture approved
- [x] Phase 2.0.1 Authorization architecture approved
- [x] Phase 2.0.2 Governance documents approved
- [ ] Explicit stakeholder approval recorded (TASKS.md checkbox)

Implementation in Phase 2.1 must conform to every item in this lock document.

---

# Document Maintenance

| Action | Owner | Trigger |
|---|---|---|
| Add locked ADR | Lead architect | New ADR accepted that changes architecture |
| Update lock table | Lead architect | Phase completion or unlock |
| Version bump | Lead architect | Material change to lock scope |

This document version: **1.0**
