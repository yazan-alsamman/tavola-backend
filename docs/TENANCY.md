# TENANCY.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

This document is the single source of truth for **how multi-tenancy is implemented**, as distinct from DOMAIN_MODEL.md (which defines *what* the tenant boundary is) and ADR-011/ADR-012 in DECISIONS.md (which record *why* these choices were made). If this document and an ADR ever disagree on a mechanism detail, the ADR's stated decision wins and this document must be corrected.

Every engineer touching a repository, controller, background job, or WebSocket handler must read this document before writing tenant-owned queries.

---

# Why This Document Exists

Multi-tenant data leakage is the single highest-severity risk category for this platform. A convention ("always filter by organizationId") is not a control — it depends on every developer remembering it in every code path, forever. This document describes the structural mechanism that makes tenant isolation the default behavior, not an opt-in discipline.

---

# The Tenant Boundary

The **Organization** (see ADR-011, DOMAIN_MODEL.md) is the tenant. Every table that is not a global reference table (`Country`, `Currency`, `Roles`, `Permissions`, `SubscriptionPlan`) or a platform-administration table carries `organizationId`, either directly or transitively through a foreign key chain (e.g., `Reservation.branchId → Branch.restaurantId → Restaurant.organizationId`).

`restaurantId` and `branchId` remain important **authorization** scopes within a tenant (an employee assigned to Branch A must not act on Branch B even though both belong to the same Organization), but they are not the outermost isolation boundary — see Employee Branch Rules in DOMAIN_MODEL.md for that layer, which is enforced by RBAC/permission checks, not by the tenant-isolation mechanism described here.

---

# Mechanism Overview

Two cooperating pieces make tenant scoping automatic:

1. **Tenant Context** — an `AsyncLocalStorage`-backed store carrying the current request's `organizationId`, `userId`, and `correlationId`, populated once per request/connection, before any application code runs.
2. **Scoped Prisma Client Extension** — a Prisma Client Extension that reads the Tenant Context and automatically merges `organizationId` into every query and write on tenant-owned models.

Neither piece is optional per-repository configuration. Every repository built on the standard injected Prisma client inherits this behavior automatically.

```
Request/Connection
        ↓
Auth Guard (validates JWT, extracts organizationId, userId, roles)
        ↓
TenantContextInterceptor → binds { organizationId, userId, correlationId } into AsyncLocalStorage
        ↓
Controller → Application Use Case (organizationId is never passed as an explicit parameter)
        ↓
Repository (Infrastructure) → injected, tenant-scoped PrismaService
        ↓
Prisma Client Extension reads AsyncLocalStorage → merges organizationId into where/create payloads
        ↓
PostgreSQL executes the tenant-scoped query
```

---

# Tenant Context Propagation Per Entry Point

## HTTP Requests

`TenantContextInterceptor` runs immediately after the JWT auth guard resolves and validates the token. It extracts `organizationId` from the token claims (never from a request body or query parameter — the client never gets to declare its own tenant) and binds it for the lifetime of the request.

## WebSocket Connections

The Socket.IO gateway extracts `organizationId` from the JWT supplied at handshake time and binds it for the lifetime of each event handler invocation triggered by that connection, using the same `AsyncLocalStorage` mechanism. See ADR-015 for how this interacts with the Redis adapter across multiple API instances — tenant context is per-instance/per-event and is not itself propagated through Redis; only the already-authorized broadcast payload is.

## Background Jobs (BullMQ)

Jobs do not have an inbound request to extract context from. Every job payload published to a queue **must** include `organizationId` explicitly as job data (not inferred), and the worker **must** explicitly establish Tenant Context from that payload as the first line of the job handler, before calling any repository. This is the one place tenant context is threaded explicitly rather than derived automatically — documented here so it is never mistaken for an oversight. CODING_STANDARDS.md codifies this as a mandatory job-authoring rule.

## System / Platform-Administration Operations

A small number of legitimate operations must read or write across tenants: platform admin dashboards, scheduled cross-tenant analytics aggregation, and support tooling. These use a distinct, explicitly named Prisma client variant (`prisma.$systemContext`), never the default tenant-scoped client. Any use of `$systemContext` must be:

* Justified in the PR description.
* Restricted to a small, clearly-named set of platform-administration services (never a feature-module repository).
* Logged as an audit event when it touches tenant-owned data, per DATABASE_SCHEMA.md's Audit Logs table (`actorType = 'System'`).

Grep-ability is a deliberate design property: `$systemContext` should never appear inside `src/modules/**`, only inside a dedicated `platform-admin` module and select BullMQ jobs (e.g., cross-tenant analytics rollups) that are explicitly reviewed for this exception.

---

# Fail-Closed Behavior

If a query against a tenant-owned model executes with no Tenant Context bound, the Prisma Client Extension throws `TenantContextMissingException` rather than executing the query unscoped. This converts a missing-context bug into an immediate, loud failure in development and CI, rather than a silent cross-tenant data leak in production. There is no "unscoped by default" mode for tenant-owned models — only the explicit `$systemContext` escape hatch, which is never the default client injected into a repository.

---

# What This Mechanism Does Not Cover

* **Branch/Restaurant-level authorization** within a tenant is a separate concern from tenant isolation, resolved by `PermissionResolver`, domain policies, and scope guards — see AUTHORIZATION_ARCHITECTURE.md and DOMAIN_MODEL.md Employee Branch Rules.
* **Row-level security at the PostgreSQL level** is not implemented in v1 (see ADR-012's Alternatives Considered) — it is tracked as an open, deferred hardening layer pending a connection-pooling-mode decision (transaction-mode PgBouncer pooling, standard for stateless horizontally-scaled API servers per NON_FUNCTIONAL_REQUIREMENTS.md, is not compatible with session-scoped `SET` variables that most RLS setups rely on). If adopted later, it would be a second, defense-in-depth layer underneath the mechanism described here, not a replacement for it.
* **Search/analytics indexes** (if a future dedicated search engine is adopted, per DECISIONS.md's Future Decisions) must implement their own equivalent tenant-scoping discipline; this document's mechanism is specific to the Prisma/PostgreSQL path.
* **Customer-owned models that legitimately span multiple organizations** (e.g. `Reservation.userId`, `Notification.userId` — Phase 9, implemented 2026-07-25 — and `Review.userId` — Phase 10, architecture frozen) carry no direct `organizationId` and are deliberately **not** added to `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` allowlist. A Customer actor has no bound `TenantContext.organizationId` to populate such a column with, and a Customer's own resources (reservations, notifications, and reviews) naturally span every organization they've ever interacted with — a required direct `organizationId` would be structurally wrong for the same reason it was found wrong for `ReservationWaitlistEntry` during Phase 7.5 (corrected by the forward migration `20260724143130_phase_7_5_1_waitlist_remove_organization_id`). Ownership for these models is enforced by direct `userId` match (`resource.userId === principal.userId`, AUTHORIZATION_ARCHITECTURE.md §10), never by tenant scoping. `Review` additionally carries a direct `restaurantId` FK — unlike `Reservation`/`Notification`, this gives it a single-hop tenant-*resolution* path (`Review.restaurantId → Restaurant.organizationId`, resolved by the calling use case via the already-tenant-scoped `RestaurantRepository`, exactly like `AddRestaurantGalleryImageUseCase` already does for `RestaurantGalleryImage`) — but this is a separate concern from the ownership-authorization rule above, and does not change the "no `organizationId` column, not in `DIRECT_TENANT_OWNED_MODELS`" conclusion. If a future phase adds an Employee/OrganizationMember-recipient notification, its tenancy must be resolved *transitively* (through whatever restaurant/branch context the source event already carries), never as a direct column on the same table Customer notifications live in.

`Offer` (Phase 11, architecture frozen 2026-07-28) follows the identical transitively-tenant-owned pattern as `RestaurantGallery`/`RestaurantSettings`/`Review`: a direct `restaurantId` FK only, resolved via the already-tenant-scoped `RestaurantRepository`, never added to `DIRECT_TENANT_OWNED_MODELS`, no `organizationId` column.

**`Conversation`/`ConversationParticipant`/`Message` (Phase 15.6, ADR-020 corrected by ADR-030, architecture designed 2026-07-30):** same pattern again — `Conversation.restaurantId` is the sole tenancy-relevant FK; none of the three Messaging tables carry `organizationId` or are added to `DIRECT_TENANT_OWNED_MODELS`. This is a direct pre-implementation correction of ADR-020's original "tenant-scoped via `organizationId`" draft, which had the same structural flaw already found and fixed for `ReservationWaitlistEntry` (Phase 7.5): a Customer starting a conversation has no bound `TenantContext.organizationId` to populate a required direct column with. `organizationId` is read off the use case's resolved `Restaurant` only when constructing domain events/audit entries.

**`Menu`/`MenuCategory`/`MenuItem`/`MenuItemOptionGroup`/`MenuItemOption`/`MenuItemAddOn`/`MenuItemAvailability` (Phase 18, architecture frozen 2026-08-02, ADR-031, ownership/availability corrected 2026-08-03, ADR-032 — not implemented, no Prisma model or migration exists):** same transitively-tenant-owned pattern as `Branch`/`Reservation`/`Review`/`Offer`: every one of the seven models carries a direct `restaurantId` FK, none carry `organizationId`, none are added to `DIRECT_TENANT_OWNED_MODELS`. Unlike `Review`/`Offer` (which carry only their immediate parent FK), `MenuCategory`/`MenuItem`/`MenuItemOptionGroup`/`MenuItemOption`/`MenuItemAddOn`/`MenuItemAvailability` additionally denormalize `restaurantId` directly rather than relying purely on a multi-hop parent-chain walk (Category→Menu→Restaurant, or deeper for Option/AddOn/Availability) — this mirrors `Table`'s existing denormalization of `floorPlanId` alongside `branchId`, keeping every tenancy resolution a single hop through the already-tenant-scoped `RestaurantRepository` regardless of how deep the entity sits in the Menu tree. Per the Testing Requirements below, implementation must include both mandatory tenancy tests for each of the seven models before this module can be considered production-ready.

**Customer Restaurant Discovery & Public Read Surface (2026-07-28):** `PrismaDiscoveryReader` (`modules/discovery/infrastructure/persistence`) is a third architecturally-justified exception injecting the raw `PrismaService` instead of the tenant-scoped `PrismaContext`, alongside `PrismaLoginOrganizationReader` and `PrismaRestaurantDirectoryReader` (Phase 3.3) - added by name to the `.eslintrc.js` `no-restricted-imports` override's `excludedFiles` list. This is deliberately **not** a `$systemContext` use: `$systemContext` is reserved for platform-admin/analytics/support tooling and must never appear inside `src/modules/**` (see "System / Platform-Administration Operations" above), whereas Discovery is an ordinary, publicly-documented Customer-facing capability whose whole purpose is to read across every organization at once - there is no tenant identity to scope by in the first place, and no query result ever includes `organizationId` or any other tenant-internal field (the underlying Result types structurally exclude it). `Restaurant`/`Branch`/`FloorPlan`/`Table` remain unchanged in `withTenantScoping` - this reader is an additional, parallel read path for the public surface, not a modification to how the Owner/Admin management endpoints are tenant-scoped.

**Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, complete/live-verified/production-verified 2026-07-30):** search, nearby, and comparison queries extend this same `PrismaDiscoveryReader` boundary (or a sibling reader under the identical raw-`PrismaService`/ESLint-allowlisted discipline) - no new tenancy-bypass mechanism, no `$systemContext` use, no change to `DIRECT_TENANT_OWNED_MODELS`. The one adjacent correction made in this phase is a projection fix, not a tenancy change: the existing floor-plan endpoint's response is narrowed to a dedicated customer-safe DTO (excluding Merge/Split topology and operational status fields) - this reduces what crosses the boundary, it does not change how the boundary itself works.

---

# Testing Requirements

Per TESTING_STRATEGY.md, every repository method that queries a tenant-owned model requires an integration test asserting that:

1. A query executed with Tenant Context bound to Organization A never returns rows belonging to Organization B, even when B's data would otherwise match the query's other filters.
2. A query executed with no Tenant Context bound throws `TenantContextMissingException` rather than returning unscoped results.

These two assertions are the minimum acceptable tenant-isolation test for any new repository method — a feature is not "production-ready" per CLAUDE.md without them.
