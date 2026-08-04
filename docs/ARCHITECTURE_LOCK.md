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
| ADR-012 | Tenant Isolation Strategy — Prisma Client Extension + Async Context Propagation | Automatic `organizationId` scoping via async context. **Decision Item 3 (`$systemContext` escape hatch) superseded by ADR-035** (2026-08-04) — the core extension/ALS mechanism (Items 1, 2, 4) is unchanged and remains locked. |
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
| ADR-020 | Customer–Restaurant Messaging | Conversation/Message schema; WebSocket delivery. Tenancy item corrected by ADR-030 (see that row) - implemented Phase 15.6, 2026-08-02. |
| ADR-030 | Messaging Tenancy Correction | Supersedes ADR-020 decision item 1 only: `Conversation`/`ConversationParticipant`/`Message` carry no direct `organizationId`, resolved transitively via `restaurantId → Restaurant.organizationId` (matches `Branch`/`Reservation`/`Review`/`Offer`). Pre-implementation correction, not a production tenancy-mechanism change. |
| ADR-021 | Billing Invoices | Invoice documents linked to payments. **Superseded/withdrawn (Owner Product-Scope Decision, 2026-07-28) — never implemented; TAVLA does not process payments. See `DECISIONS.md` ADR-021 Disposition.** |
| ADR-022 | Phone/WhatsApp-First Customer Registration (~~Fonnte~~ **provider updated to LightOTP by ADR-024**) & Administratively-Provisioned Restaurant Owners | Customer registration is phone-first (username + E.164 phone, WhatsApp OTP via LightOTP per ADR-024, password set only after verification); Restaurant Owners are administratively provisioned by Platform Admin (email + password, no verification step); partially supersedes ADR-016 (see that row) |
| ADR-023 | Multi-Table Reservation Reschedule Concurrency | Extends ADR-013's single-table advisory-lock mechanism with a deterministic two-key acquisition protocol (sorted-order locking, one key per Table) for the one new scenario Phase 7.3 introduces: Rescheduling an Approved reservation to a different Table within the same Branch. Does not alter ADR-013's own text; same-table Reschedule and Reschedule-of-Pending reuse ADR-013's existing single-key mechanism unchanged. |
| ADR-024 | OTP Delivery Provider Migration: Fonnte → LightOTP | Supersedes only ADR-022's "Fonnte Integration Boundary" subsection - the Customer phone-OTP business rule is unchanged, only the delivery provider. `VerificationMessagingPort` absorbs the swap with zero application/domain-layer changes; `toPhoneE164` now sent with its leading `+` (LightOTP requires it; Fonnte forbade it); LightOTP's API has no custom-message field, so the previously approved WhatsApp copy can no longer be sent as application-controlled text. |
| ADR-025 | OneSignal Identity Verification (amends ADR-007's Implementation Rule) | Adopts ES256-signed JWTs (backend-held private key) to prove `external_id` ownership to OneSignal before it accepts subscription/identity operations, closing a documented spoofing risk in OneSignal's default `external_id` matching. Does not reopen ADR-007's provider choice or Anti-Corruption Layer requirement. Frozen alongside the Phase 9 pre-implementation architecture decisions (`TASKS.md`); implemented 2026-07-25 (signing code + unit tests) — no real key/secret provisioned this session, so live signing against a real OneSignal app remains unverified. |
| ADR-026 | Table Merge/Split Topology and Concurrency (references ADR-013 and ADR-023) | Primary Table merge identity; `mergeGroupId` + `isMergePrimary`; `TableStatus.Merged` for secondaries; derived effective capacity (sum); reservation blocking by non-ended Pending/Approved; topology advisory locks on Table.id (acquired before ADR-013/023 slot locks); Split = undo merge only. Architecture frozen 2026-07-25; **implemented and live-verified 2026-07-26** (see `TASKS.md`'s Phase 6 Merge/Split Implementation & Verification Report). |
| ADR-027 | Subscription System as Entitlement/Access Contract (Not Billing) | Phase 12 pre-implementation freeze (2026-07-28). Subscription = entitlement/access contract, never billing (reaffirms the payment-removal decision, ADR-021 Disposition). Organization-level ownership (reaffirms ADR-011). Three structural limits only (`maxRestaurants`, `maxBranchesPerRestaurant`, `maxEmployeesPerRestaurant`) — explicitly no reservation-volume limit. Two-tier usage tracking (`SubscriptionUsage` org-scoped, new `RestaurantUsage` restaurant-scoped) resolving a per-Restaurant-limit cardinality mismatch. PlatformAdmin-only assignment; no checkout. **Architecture frozen only — not implemented, no Prisma model exists; implementation requires separate explicit authorization.** |
| ADR-028 | Analytics Architecture — Operational Restaurant Analytics (Read-Only, No New Persistence) | Phase 14 pre-implementation freeze (2026-07-28). Direct PostgreSQL reads over existing operational tables (`Reservation`, `ReservationWaitlistEntry`, `Restaurant`, `Branch`, `Review`) via `Controller → Query Use Case → AnalyticsQueryPort → Prisma` — no new tables, materialized views, Redis cache, BullMQ worker, or event sourcing in v1. `Branch.timezone` authoritative; timezone-bucketed series (service-day trend, booking-created trend, Peak Hours) require explicit single-Branch scope. Dual-actor authorization (OrganizationMember Owner/Admin **or** Employee with existing `reports:view` slug), resolved by use-case-level branching, same pattern as ADR-026 — no new permission slug, no new guard-composition mechanism. Exact historical occupancy percentage excluded (no historical capacity/topology snapshot exists). Found and froze a read-side fix for a pre-existing data-quality gap: `Reservation.reservationDate` is proven not reliably Branch-local (UTC-derived on 3 of 4 creation/mutation paths), so service-day/booking-created bucketing derives the branch-local date from `reservationStartTime`/`createdAt` + `Branch.timezone` at query time instead of trusting the stored column. **Implemented and live-verified 2026-07-28** (see `TASKS.md`'s Phase 14 Implementation & Verification Report). |
| ADR-031 | Menu Management Architecture | Phase 18 pre-implementation freeze (2026-08-02). One Menu per Restaurant (`@@unique([restaurantId])`), containing Categories, containing Items; configurable Option Groups/Options and Add-ons modeled as relational entities (not `Json`); `Decimal(10,2)` money matching the existing `Offer.discountValue` convention; images via the existing polymorphic `FileRecord` mechanism (`FileOwnerType.Menu`, already reserved — zero File module changes); transitively-tenant-owned like `Branch`/`Reservation`/`Review`/`Offer` (no `organizationId` column); new `menu:manage` permission slug; new bulk-reorder endpoint pattern (`PATCH .../reorder`) with no prior precedent. No integration with Reservations/Reviews/Offers/Messaging/Analytics/Notifications/Realtime; Discovery exposes only a derived `hasMenu` boolean. **Architecture frozen only — not implemented, no Prisma model exists; implementation requires separate explicit authorization. Ownership/availability items corrected by ADR-032** (see that row). |
| ADR-032 | Menu Ownership, Availability, and Featured-Item Reconciliation | Phase 18 pre-implementation reconciliation (2026-08-03). Supersedes only ADR-031 Decision Item 2 (singleton Menu) and the `scheduleJson` field: Restaurant now owns 1:N Menus with exactly one non-deleted `isDefault` Menu, enforced by a partial unique index (reusing ADR-026's `Table.isMergePrimary` mechanism verbatim, not a new pattern); `MenuItem` availability becomes a relational `MenuItemAvailability` table (`dayOfWeek`/`startTime`/`endTime`), matching the existing `WorkingHours`/`BranchWorkingHours` convention rather than the stale, dead-code `Branch.openingHours` `Json` precedent ADR-031 had cited; adds `MenuItem.isFeatured`. Confirms `displayOrder` already consistent across all six ADR-031 entities (no change) and explicitly declines to add `MenuItem.sku` pending a real POS/Inventory/ERP integration ADR. **Architecture frozen only — not implemented; implementation requires separate explicit authorization.** |
| ADR-033 | Customer Acquisition & Pricing Engine — Financial Source of Truth, Not Billing | Phase 19 pre-implementation freeze (2026-08-04). Acquisition = first `Approved` reservation per `(Restaurant, Customer-Identity)`, `source ≠ WalkIn`; one-time per relationship; never reversed automatically, only via explicit PlatformAdmin-authorized Reversal or symmetric Manual Recording; concurrency-safe via a partial unique index + atomic insert (reuses ADR-026/027 patterns). Single `AcquisitionPricingRule` table (Platform/Organization/Restaurant scope, effective-dated, never edited in place); fee snapshotted onto each acquisition so historical records never change after a pricing change; `Percentage` fee type structurally defined but functionally disabled (no monetary base value exists anywhere in this schema); currency must match exactly, no FX conversion, ever. Revenue metrics limited to "Recorded"/"Reversed" — no "Collected"/"Outstanding." Export authorized as the complete invoice-readiness mechanism; no settlement/invoice field added. **Architecture frozen only — not implemented, no Prisma model exists; implementation requires separate explicit authorization.** |
| ADR-034 | Platform Back Office — PlatformAdmin Operational Authority | Phase 19 pre-implementation freeze (2026-08-04). Extends `AuditActorType` with `PlatformAdmin` and authorizes a new Audit Log Read API (both prerequisites for everything else in this ADR). PlatformAdmin gains Suspend/Reactivate/Delete/Restore over Restaurant and Organization (reusing existing events/fields; Organization Suspend never cascades to `Restaurant.status`, reusing ADR-027's own dual-writer-hazard reasoning); a narrow PlatformAdmin-only emergency ownership transfer (full self-service Organization management explicitly out of scope); Force Logout/Credential Reset/Disable Login account-access-control capabilities; PlatformAdmin account CRUD (finally delivering FR-19.1); a two-tier `PlatformAdmin`/`PlatformSupport` role (new decorator+guard pair, not an ADR-026/028-style dual-actor OR-composition); narrow per-entity lookup (not a search engine). Impersonation, bulk operations, and most operational-monitoring widgets explicitly rejected as unjustified. **Architecture frozen only — not implemented; implementation requires separate explicit authorization.** |
| ADR-035 | Cross-Tenant Access Patterns — Formalizing Explicit Tenant Rebind and Tenant-Agnostic Raw Reader | Phase 19 architecture correction (2026-08-04). **Supersedes ADR-012 Decision Item 3 only.** Direct source inspection found `prisma.$systemContext` was never implemented; retires it as a distinct mechanism and formally names the two real, already-shipped patterns that solve the same problem: Explicit Tenant Rebind (PlatformAdmin actions on one caller-specified tenant, reusing ordinary tenant-scoped repositories via a manual `TenantContextPort.runAsync()` rebind — the mechanism `PlatformAdminSubscriptionsController` already uses) and Tenant-Agnostic Raw Reader (genuinely cross-tenant reads with no single tenant identity, raw `PrismaService`, ESLint-whitelisted — the mechanism `PrismaDiscoveryReader` already uses). No third mechanism introduced. ADR-012's core extension/ALS mechanism is unchanged. **Documentation correction, not a production tenancy-mechanism change — no code changes as a result of this ADR.** |

These ADRs extend `DATABASE_SCHEMA.md` and `DOMAIN_MODEL.md` without breaking locked ADR-001–017 decisions. ADR-033/034 are pre-implementation freezes following the established two-step convention (freeze, then separate explicit implementation authorization) used by every phase since ADR-026. ADR-035 is a documentation-only correction of an unimplemented sub-mechanism of ADR-012, the same category of correction ADR-030 made to ADR-020. ADR-022 is the first post-lock extension to partially supersede an original locked ADR rather than only adding new scope — see its own entry above and ADR-016's annotated row. ADR-024 is the first post-lock extension to supersede only a *subsection* of another post-lock ADR (ADR-022's Fonnte contract) while leaving that ADR's remaining decisions (Customer identity, registration/recovery state machines, Owner provisioning) fully intact. ADR-025 is the second such narrow amendment, targeting only ADR-007's Implementation Rule. ADR-026 is a post-lock extension that **references** ADR-013/ADR-023 concurrency without rewriting their historical text (same style as ADR-023 relative to ADR-013). ADR-027 similarly **references** ADR-011 (Organization-level subscription ownership) and ADR-021's Disposition (payment exclusion) without rewriting either's historical text, and corrects stale, pre-payment-removal billing assumptions that had been drafted into `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md`/`EVENTS.md` in 2026-07-07 but never implemented. ADR-028 similarly **references** ADR-026's dual-actor use-case-branching pattern and ADR-027 §15's Phase 12/14 analytics boundary without rewriting either's historical text, and reads (but does not modify) `Reservation.reservationDate`, correcting a stale assumption that it is Branch-local.

**Numbering reconciliation (2026-07-25):** this table previously listed a stale ADR-001–017 numbering (written 2026-07-07, before `DECISIONS.md` was expanded with additional early-stack ADRs — "Use Socket.IO" and "Use OneSignal Instead of Firebase" in particular — which shifted every subsequent ADR's number). The prior table, for example, showed "ADR-007 | PostgreSQL as Primary Database" and a standalone "ADR-008 | Argon2 for Password Hashing" — neither matches `DECISIONS.md`'s current, authoritative numbering (PostgreSQL is ADR-002; Argon2id is decision item 5 *within* ADR-016, not its own ADR at all). This was discovered during the Phase 9 pre-implementation readiness review (2026-07-25) and is corrected above by re-deriving the table directly from `DECISIONS.md`'s current `## ADR-NNN` headings. This is a documentation-only correction — no ADR was renumbered, no ADR content was rewritten, and the governing rule itself ("all Accepted ADRs in `DECISIONS.md` are locked") was never in question, since it does not depend on this table being accurate.

---

# Locked Architecture Documents

The following documents are the **authoritative specification** for locked concerns. Implementation must conform; contradictions are bugs in code, not in docs.

| Document | Locked content |
|---|---|
| `ARCHITECTURE.md` | Layers, modules, data flow, scalability principles |
| `DOMAIN_MODEL.md` | Aggregates, entities, business rules, domain services, policies |
| `DATABASE_SCHEMA.md` | Table shapes, indexes, constraints, relationships |
| `TENANCY.md` | Tenant context propagation, Prisma extension, cross-tenant access patterns (Explicit Tenant Rebind, Tenant-Agnostic Raw Reader — ADR-035) |
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
