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

All ADRs with status **Accepted** in `DECISIONS.md` are locked — this rule, not the enumeration table below, is the governing authority. (See "Numbering reconciliation, 2026-07-25" at the end of this section for a documentation-only correction to this table.)

| ADR | Title | Locked decision (summary) |
|---|---|---|
| ADR-001 | Use NestJS as the Backend Framework | NestJS for HTTP, WebSocket, DI |
| ADR-002 | Use PostgreSQL | PostgreSQL 17+ as the primary database |
| ADR-003 | Use Prisma ORM | Prisma + migrations; repository pattern mandatory |
| ADR-004 | Use Redis | Single Redis deployment; caching, sessions, queues, pub/sub, logical separation |
| ADR-005 | Use BullMQ | Async work via BullMQ only |
| ADR-006 | Use Socket.IO | Realtime transport choice (extended by ADR-015's Redis Adapter for horizontal scaling) |
| ADR-007 | Use OneSignal Instead of Firebase | Provider-independent `NotificationProvider` abstraction; OneSignal is the current provider, never called directly by application/domain code. **Amended by ADR-025** (2026-07-25): OneSignal Identity Verification. |
| ADR-008 | Use MinIO | S3-compatible object storage |
| ADR-009 | Multi-Tenant Architecture | Row-level isolation (superseded in mechanism by ADR-011/012; principle retained) |
| ADR-010 | Soft Delete Strategy | `deletedAt` on applicable entities |
| ADR-011 | Introduce an Organization Aggregate as the Tenant Boundary | `organizationId` is outermost tenant scope |
| ADR-012 | Tenant Isolation Strategy — Prisma Client Extension + Async Context Propagation | Automatic `organizationId` scoping via async context |
| ADR-013 | Reservation Concurrency Strategy | Advisory lock + exclusion constraint |
| ADR-014 | GDPR Data Retention and Anonymization Strategy | Anonymize-in-place; no hard delete of User row |
| ADR-015 | WebSocket Horizontal Scaling — Socket.IO Redis Adapter | Horizontal WebSocket fan-out via Redis (implements Phase 8) |
| ADR-016 | Authentication & Session Strategy | Identity, JWT, opaque refresh rotation, Argon2id password hashing (decision item 5), email verification gate. **Partially superseded by ADR-022** (2026-07-22): email verification no longer applies to customer registration or administratively-provisioned Restaurant Owner accounts. All other mechanics remain locked and unchanged. |
| ADR-017 | Authorization Strategy | Auth/authz separation; Policy Engine; PermissionResolver |

**Post-lock extensions (Architecture Compliance Audit 2026-07-07, and later additions):**

| ADR | Title | Summary |
|---|---|---|
| ADR-018 | Search & Restaurant Discovery | PostgreSQL-first search; optional search engine at scale |
| ADR-019 | Waitlist & Operational Signals | Waitlist aggregate; reminders; late arrival; table ready |
| ADR-020 | Customer–Restaurant Messaging | Conversation/Message schema; WebSocket delivery |
| ADR-021 | Billing Invoices | Invoice documents linked to payments |
| ADR-022 | Phone/WhatsApp-First Customer Registration (~~Fonnte~~ **provider updated to LightOTP by ADR-024**) & Administratively-Provisioned Restaurant Owners | Customer registration is phone-first (username + E.164 phone, WhatsApp OTP via LightOTP per ADR-024, password set only after verification); Restaurant Owners are administratively provisioned by Platform Admin (email + password, no verification step); partially supersedes ADR-016 (see that row) |
| ADR-023 | Multi-Table Reservation Reschedule Concurrency | Extends ADR-013's single-table advisory-lock mechanism with a deterministic two-key acquisition protocol (sorted-order locking, one key per Table) for the one new scenario Phase 7.3 introduces: Rescheduling an Approved reservation to a different Table within the same Branch. Does not alter ADR-013's own text; same-table Reschedule and Reschedule-of-Pending reuse ADR-013's existing single-key mechanism unchanged. |
| ADR-024 | OTP Delivery Provider Migration: Fonnte → LightOTP | Supersedes only ADR-022's "Fonnte Integration Boundary" subsection - the Customer phone-OTP business rule is unchanged, only the delivery provider. `VerificationMessagingPort` absorbs the swap with zero application/domain-layer changes; `toPhoneE164` now sent with its leading `+` (LightOTP requires it; Fonnte forbade it); LightOTP's API has no custom-message field, so the previously approved WhatsApp copy can no longer be sent as application-controlled text. |
| ADR-025 | OneSignal Identity Verification (amends ADR-007's Implementation Rule) | Adopts ES256-signed JWTs (backend-held private key) to prove `external_id` ownership to OneSignal before it accepts subscription/identity operations, closing a documented spoofing risk in OneSignal's default `external_id` matching. Does not reopen ADR-007's provider choice or Anti-Corruption Layer requirement. Frozen alongside the Phase 9 pre-implementation architecture decisions (`TASKS.md`); implemented 2026-07-25 (signing code + unit tests) — no real key/secret provisioned this session, so live signing against a real OneSignal app remains unverified. |
| ADR-026 | Table Merge/Split Topology and Concurrency (references ADR-013 and ADR-023) | Primary Table merge identity; `mergeGroupId` + `isMergePrimary`; `TableStatus.Merged` for secondaries; derived effective capacity (sum); reservation blocking by non-ended Pending/Approved; topology advisory locks on Table.id (acquired before ADR-013/023 slot locks); Split = undo merge only. Architecture frozen 2026-07-25; **implemented and live-verified 2026-07-26** (see `TASKS.md`'s Phase 6 Merge/Split Implementation & Verification Report). |

These ADRs extend `DATABASE_SCHEMA.md` and `DOMAIN_MODEL.md` without breaking locked ADR-001–017 decisions. ADR-022 is the first post-lock extension to partially supersede an original locked ADR rather than only adding new scope — see its own entry above and ADR-016's annotated row. ADR-024 is the first post-lock extension to supersede only a *subsection* of another post-lock ADR (ADR-022's Fonnte contract) while leaving that ADR's remaining decisions (Customer identity, registration/recovery state machines, Owner provisioning) fully intact. ADR-025 is the second such narrow amendment, targeting only ADR-007's Implementation Rule. ADR-026 is a post-lock extension that **references** ADR-013/ADR-023 concurrency without rewriting their historical text (same style as ADR-023 relative to ADR-013).

**Numbering reconciliation (2026-07-25):** this table previously listed a stale ADR-001–017 numbering (written 2026-07-07, before `DECISIONS.md` was expanded with additional early-stack ADRs — "Use Socket.IO" and "Use OneSignal Instead of Firebase" in particular — which shifted every subsequent ADR's number). The prior table, for example, showed "ADR-007 | PostgreSQL as Primary Database" and a standalone "ADR-008 | Argon2 for Password Hashing" — neither matches `DECISIONS.md`'s current, authoritative numbering (PostgreSQL is ADR-002; Argon2id is decision item 5 *within* ADR-016, not its own ADR at all). This was discovered during the Phase 9 pre-implementation readiness review (2026-07-25) and is corrected above by re-deriving the table directly from `DECISIONS.md`'s current `## ADR-NNN` headings. This is a documentation-only correction — no ADR was renumbered, no ADR content was rewritten, and the governing rule itself ("all Accepted ADRs in `DECISIONS.md` are locked") was never in question, since it does not depend on this table being accurate.

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
* **Email verification gate** before login — **scope narrowed by ADR-022** (2026-07-22): applies only where a genuine email-based, self-service actor exists. Customer (`User`) registration is phone/WhatsApp-verified instead (ADR-022); Restaurant Owner accounts are administratively provisioned by Platform Admin and require no verification step at all. No email/password actor in the current model retains a mandatory pre-login verification gate.

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
