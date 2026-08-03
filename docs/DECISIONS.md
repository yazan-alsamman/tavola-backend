# ARCHITECTURE DECISIONS LOG

This document records all major architectural decisions made during the project.

Every important technical decision must be documented here before implementation.

---

# Decision Template

## Decision ID

ADR-XXX

---

## Title

Short descriptive title.

---

## Date

YYYY-MM-DD

---

## Status

* Proposed
* Accepted
* Deprecated
* Replaced

---

## Context

Describe the problem that required a decision.

---

## Decision

Describe the chosen solution.

---

## Alternatives Considered

List every reasonable alternative and explain why it was rejected.

---

## Consequences

### Positive

* Advantage 1
* Advantage 2
* Advantage 3

### Negative

* Trade-off 1
* Trade-off 2

---

## Impact

Which modules are affected?

---

# Accepted Decisions

---

## ADR-001

### Title

Use NestJS as the Backend Framework

### Status

Accepted

### Context

The application requires a scalable enterprise backend.

### Decision

NestJS will be used due to its modular architecture, dependency injection, testing support, and excellent TypeScript ecosystem.

### Alternatives

* Express
* Fastify
* Laravel
* Spring Boot

### Consequences

Pros

* Excellent maintainability
* Modular structure
* Enterprise-ready
* Strong community

Cons

* Slightly higher learning curve

---

## ADR-002

### Title

Use PostgreSQL

### Status

Accepted

### Decision

PostgreSQL is the primary relational database.

Reasons

* ACID compliance
* High performance
* Advanced indexing
* JSON support
* Excellent scalability

---

## ADR-003

### Title

Use Prisma ORM

### Status

Accepted

Reasons

* Type safety
* Migration system
* Developer productivity
* Excellent NestJS integration

---

## ADR-004

### Title

Use Redis

### Status

Accepted

Purpose

* Cache
* Sessions
* Queues
* Rate limiting
* Temporary reservation locks

---

## ADR-005

### Title

Use BullMQ

### Status

Accepted

Purpose

Background processing

Examples

* Notifications
* Reservation reminders
* Expiration jobs
* Analytics
* Scheduled tasks

---

## ADR-006

### Title

Use Socket.IO

### Status

Accepted

Reason

Real-time synchronization for table availability and reservation updates.

---

## ADR-007

### Title

Use OneSignal Instead of Firebase

### Status

Accepted

Reason

The project requires a provider-independent notification system.

OneSignal offers:

* Cross-platform support
* REST APIs
* Dashboard management
* Easy future replacement through abstraction

Implementation Rule

The application must never communicate directly with OneSignal.

All notifications pass through:

NotificationProvider

Future providers may include:

* Apple Push Notification Service (APNs)
* Huawei Push Kit
* SMS providers

(Email providers removed from scope — 2026-07-25 product decision, TASKS.md's Phase 9 section; this illustrative list was never a binding requirement to reuse Email specifically, so no ADR amendment/supersession was needed — only this example list changed.)

---

## ADR-008

### Title

Use MinIO

### Status

Accepted

Purpose

S3-compatible object storage.

Benefits

* Self-hosted
* Scalable
* Secure
* Vendor-independent

---

## ADR-009

### Title

Multi-Tenant Architecture

### Status

Superseded by ADR-011 and ADR-012

Decision (original, retained for history per this document's immutability rule)

The system will use logical tenant isolation based on Restaurant ID, enforced in the application layer and database queries.

Every query accessing restaurant-owned data must be scoped by the authenticated restaurant identifier.

### Superseding Note

The core principle — logical, row-level tenant isolation enforced at the application and query layer, rather than separate databases/schemas per tenant — remains correct and is carried forward. What changed: the tenant-scoping identifier is `organizationId`, not `restaurantId` (see ADR-011, since a single Organization may own multiple Restaurants), and the enforcement mechanism is now explicitly a Prisma Client Extension with async context propagation rather than an unspecified "application layer" convention (see ADR-012 and TENANCY.md). `restaurantId`/`branchId` remain important authorization scopes *within* a tenant, but are no longer the outermost isolation boundary.

---

## ADR-010

### Title

Soft Delete Strategy

### Status

Accepted

Decision

Business entities are soft deleted whenever possible.

Auditability must always be preserved.

---

## ADR-011

### Title

Introduce an Organization Aggregate as the Tenant Boundary

### Status

Accepted

### Date

2026-07-06

### Context

The original domain model treated `Restaurant` as both a business entity and the implicit tenant boundary (ADR-009 scopes queries by `restaurantId`). This breaks down the moment a single business owns more than one restaurant brand or a chain with multiple restaurants — a common case in this industry (restaurant groups, franchises). Under the original model, each restaurant would need its own owner `User` and its own `Subscription`, with no way to share billing, staff, or reporting across a portfolio of restaurants. This directly contradicts the platform's goal of serving "thousands of restaurants" as a SaaS product, since real SaaS customers in this space are frequently organizations that operate multiple restaurant brands.

### Decision

Introduce an **Organization** aggregate as the single, authoritative tenant boundary for the entire platform. `Restaurant` becomes a child concept owned by an Organization, not a tenant itself.

Redesigned structure:

```
Organization (tenant root)
 ├── OrganizationMember (User + role: Owner, Admin, Billing, Staff)
 ├── Subscription (moved from Restaurant → Organization)
 └── Restaurant (one or many)
      └── Branch (one or many)
           ├── Table
           ├── FloorPlan
           └── Employee (branch-scoped, see ADR employee rules in DOMAIN_MODEL.md)
```

Key rules:

* Every `Restaurant.organizationId` is required and immutable after creation.
* `Subscription` and billing move from `Restaurant` to `Organization`. A subscription plan's limits (max restaurants, max branches, max employees) are enforced against the Organization, not per-restaurant.
* `User.ownerId`-style single ownership is replaced by `OrganizationMember`, a join entity carrying a role (`Owner`, `Admin`, `Billing`, `Staff`) so multiple people can administer one Organization, and one person can belong to multiple Organizations (e.g., a consultant managing several restaurant groups).
* **`organizationId` becomes the tenant-scoping column used by the isolation mechanism in ADR-012**, replacing `restaurantId` as the primary isolation key. `restaurantId` and `branchId` remain important for authorization scoping *within* a tenant (an Organization employee assigned to Branch A shouldn't manage Branch B), but the outermost isolation boundary is the Organization.

### Alternatives Considered

* **Keep Restaurant as the tenant boundary (status quo).** Rejected: cannot represent restaurant chains/groups without duplicating billing and staff per restaurant; the cheapest time to fix this is before any data exists.
* **Make User the tenant boundary (personal-account model).** Rejected: doesn't match the B2B nature of the product — restaurants are businesses with multiple staff members, not individual accounts.
* **Defer Organization to a later phase and migrate later.** Rejected: `Restaurant`, `Employee`, `Subscription`, and `User` tables would all require a breaking migration (backfilling `organizationId`, splitting subscriptions) once real reservations, employees, and billing history exist. The cost of adding this now (before Phase 1 code exists) is a documentation change; the cost of adding it after Phase 5+ is a production data migration. Reject deferral.

### Consequences

#### Positive

* Restaurant chains/groups are supported natively — the actual target customer profile for a reservation SaaS at "thousands of restaurants" scale.
* Billing, subscription limits, and staff administration consolidate at the correct business level.
* `organizationId` gives the tenant-isolation mechanism (ADR-012) one unambiguous scoping column for every tenant-owned table, rather than reasoning about `restaurantId` inconsistently across modules.
* Future features (cross-restaurant reporting for a chain, shared loyalty programs across an organization's restaurants) become possible without further schema changes.

#### Negative

* Adds one more join (`Restaurant → Organization`) to most authorization checks.
* Slightly increases onboarding complexity (a new Organization must exist before a Restaurant can be created) — mitigated by auto-creating a default Organization transparently during restaurant-owner signup, so single-restaurant customers never see the concept in the UI.

### Impact

Affects: Restaurant Aggregate, User Aggregate, Subscription Aggregate, Employee Aggregate, DATABASE_SCHEMA.md (new `organizations` and `organization_members` tables, `organizationId` FK added to `restaurants`), all repository interfaces that scope by tenant, and ADR-012 (tenant isolation).

---

## ADR-012

### Title

Tenant Isolation Strategy — Prisma Client Extension + Async Context Propagation

### Status

Accepted

### Date

2026-07-06

### Context

ADR-009 stated that tenant isolation would be enforced "in the application layer and database queries" without naming a concrete mechanism. Relying on every developer to remember to add `WHERE organizationId = ...` to every query is the single highest-severity risk in a multi-tenant SaaS: one missed clause in one repository method leaks cross-tenant data. A mechanism must guarantee scoping rather than merely convention.

### Decision

Use a **Prisma Client Extension** (the modern, supported replacement for the deprecated Prisma Middleware API) that automatically injects `organizationId` (and, where applicable, `restaurantId`/`branchId`) into every query for tenant-owned models, combined with **async context propagation** to carry the authenticated tenant identifier from the HTTP/WebSocket request into the extension without threading it manually through every service method.

Architecture:

1. **Tenant Context (Async Local Storage).** A `TenantContextService`, backed by Node's `AsyncLocalStorage`, stores the current request's `organizationId`, `restaurantId` (if scoped), `userId`, and `correlationId`. A NestJS interceptor (`TenantContextInterceptor`), registered globally, populates this store at the very start of the request lifecycle — immediately after the JWT auth guard resolves the token and before any controller/service code runs. The same interceptor variant applies to the Socket.IO gateway for WebSocket connections, populated at handshake time.
2. **Scoped Prisma Client Extension.** A Prisma Client Extension wraps every query (`findMany`, `findFirst`, `update`, `delete`, `count`, etc.) on tenant-owned models (`Restaurant`, `Branch`, `Table`, `Reservation`, `Employee`, `Review`, `Menu`, `Offer`, and others carrying `organizationId` transitively). The extension reads the current tenant context via `AsyncLocalStorage` and:
   * Automatically merges `organizationId: currentOrgId` into every `where` clause.
   * Automatically sets `organizationId` on every `create`/`createMany` payload.
   * Throws a domain-level `TenantContextMissingException` if a query executes with no tenant context bound (e.g., a background job that forgot to establish context) rather than silently running unscoped — fail closed, never fail open.
3. **Explicit escape hatch for system/background operations.** A small number of legitimate cross-tenant operations exist (platform admin dashboards, scheduled jobs that operate across all organizations, analytics aggregation). These use a distinct, explicitly named `prisma.$systemContext` client variant that bypasses the extension — never the default client — so cross-tenant access is always a deliberate, auditable, grep-able choice in the codebase, never an accident.
4. **Repository layer stays thin.** Repositories (Infrastructure layer, per ARCHITECTURE.md) always use the tenant-scoped Prisma client instance injected via DI. Application-layer use cases never see `organizationId` as a parameter they must remember to pass — it flows implicitly through context, eliminating the class of bug where a developer forgets to pass or filter by tenant.

### Why This Approach

* **Prisma Middleware is deprecated** (superseded by Client Extensions since Prisma 4.16+); building new tenant-critical infrastructure on a deprecated API is an unacceptable long-term maintenance risk for a platform meant to last five years.
* **Client Extensions operate at the query-builder level**, so scoping is enforced regardless of which service or module issues the query — it cannot be bypassed by a developer forgetting a `where` clause, unlike a convention-only approach.
* **AsyncLocalStorage avoids parameter-threading** `organizationId` through every function signature in every layer, which would be invasive, error-prone (easy to forget one parameter), and would leak infrastructure concerns (tenant context) into the Domain layer, violating the framework-independence rule in DOMAIN_MODEL.md.
* **Fail-closed default** (throwing when no context is bound) means a missing-context bug surfaces immediately as an error in testing, not as a silent cross-tenant data leak in production.

### Tenant Context Flow

```
JWT (contains organizationId, userId, roles)
        ↓
AuthGuard validates + decodes token
        ↓
TenantContextInterceptor stores { organizationId, userId, correlationId } in AsyncLocalStorage
        ↓
Controller → Application Use Case (no tenant parameter needed)
        ↓
Repository (Infrastructure) calls scoped Prisma Client
        ↓
Prisma Client Extension reads AsyncLocalStorage, injects organizationId into query
        ↓
PostgreSQL executes tenant-scoped query
```

For WebSocket connections, the same `organizationId` is extracted at Socket.IO handshake (from the JWT passed during connection) and bound to the async context for the lifetime of each event handler invocation — see ADR-015 for the broader realtime architecture.

### Alternatives Considered

* **Prisma Middleware.** Rejected: deprecated API, no long-term support guarantee.
* **PostgreSQL Row-Level Security (RLS).** A defense-in-depth option, not rejected outright — recommended as a *future hardening layer* (tracked as an open decision, see Phase 0 report) once the connection-pooling strategy (PgBouncer session vs. transaction mode, required for `SET app.current_org`-style RLS session variables) is finalized. Not chosen as the *primary* mechanism for v1 because it requires a session-scoped Postgres role/variable per request, which conflicts with transaction-mode connection pooling (the default for horizontally-scaled stateless API servers per NON_FUNCTIONAL_REQUIREMENTS.md). May be added later as a second layer without contradicting this ADR.
* **Manual `organizationId` parameter threading through every service/repository call.** Rejected: relies on developer discipline, the exact failure mode this ADR exists to eliminate.
* **Separate database/schema per tenant.** Rejected: operationally infeasible at "thousands of restaurants" scale (thousands of schemas/databases to migrate and back up); logical isolation is the correct trade-off at this scale, consistent with ADR-009.

### Consequences

#### Positive

* Cross-tenant data leakage becomes structurally difficult rather than a matter of code review vigilance.
* New repository methods automatically inherit tenant safety with zero additional code.
* Background jobs and admin tools are forced to make cross-tenant access explicit and auditable.

#### Negative

* Adds a small amount of framework-level complexity (the extension itself) that must be well-tested, since a bug in the extension is now a single point of failure for isolation.
* Developers must learn the `$systemContext` escape hatch and when its use is legitimate — requires clear CODING_STANDARDS.md guidance and code review scrutiny on any use of it.

### Impact

Affects: Infrastructure layer (Prisma module setup), `common/guards`, a new `common/context` module (TenantContextService + interceptor), all tenant-owned repositories, BullMQ job authoring (workers must explicitly establish tenant context before repository calls), CODING_STANDARDS.md (new rule on `$systemContext` usage), TENANCY.md (new document, see Phase 0 deliverables).

---

## ADR-013

### Title

Reservation Concurrency Strategy — PostgreSQL Advisory Locks with Exclusion Constraint Safety Net

### Status

Accepted

### Date

2026-07-06

### Context

The business rule "a table cannot have overlapping confirmed reservations" and the NFR "reservation conflicts must never occur" require a concrete concurrency-control mechanism. Reservation creation is fundamentally a **race on an insert**, not an update — two concurrent requests for the same table and overlapping time window may both see "no conflicting row exists" before either commits. Row-level locking alone (`SELECT ... FOR UPDATE`) does not protect against this phantom-insert scenario unless the row already exists; optimistic locking (a `version` column) protects concurrent *updates* to an existing row but does nothing to prevent two independent inserts from ever occurring. A mechanism is needed that serializes concurrent attempts to book the *same table for an overlapping time window*, without serializing unrelated bookings (different tables, different times), since the NFR also requires "hundreds of reservation requests per second."

### Decision

Use **PostgreSQL transaction-level advisory locks** (`pg_advisory_xact_lock`) as the primary concurrency-control mechanism for reservation creation and approval, keyed by a deterministic hash of `(branchId, tableId, reservationDate, reservationTimeSlotBucket)`, combined with a **PostgreSQL exclusion constraint** (`EXCLUDE USING gist`, requiring the `btree_gist` extension) on the `reservations` table as a defense-in-depth database-level safety net.

Mechanics:

1. **Advisory lock as the primary gate.** Before inserting a new `Reservation` (or approving a `Pending` one), the Application layer's `ReservationAvailabilityService` computes a 64-bit hash key from `(branchId, tableId, date, timeSlotBucket)` and calls `pg_advisory_xact_lock(key)` inside the same database transaction as the availability check and insert. The lock is automatically released when the transaction commits or rolls back — no manual unlock, no risk of a leaked lock outliving a crashed process.
2. **Time-slot bucketing.** Reservation times are bucketed to the restaurant's configured `reservationInterval` (a `RestaurantSettings` value, e.g., 15/30 minutes) so that two reservations in the same bucket contend for the same lock, while reservations in genuinely non-overlapping buckets do not block each other — preserving throughput.
3. **Exclusion constraint as safety net.** Independently of application-level locking, the `reservations` table carries a database constraint preventing two rows with the same `tableId` and overlapping `[startTime, endTime)` ranges from both existing in a non-cancelled status. This protects against any code path that bypasses the service layer (a bug, a future direct migration script, or a future microservice that forgets to acquire the lock) — the database itself refuses the second row, surfacing as a `ReservationConflictException` translated from the underlying Postgres exclusion-violation error.
4. **Scope of locking.** Only the specific `(branch, table, timeslot)` tuple under contention is serialized. Two customers booking different tables, or the same table at non-overlapping times, proceed fully in parallel — this is what allows the mechanism to scale to hundreds of requests/second platform-wide.

### Alternatives Considered

* **`SELECT ... FOR UPDATE` on existing reservation rows.** Rejected as the sole mechanism: does not prevent the phantom-insert race (two transactions both querying "any conflicting row?" and finding none, then both inserting) unless paired with `SERIALIZABLE` isolation, which introduces frequent serialization-failure retries under load and is a heavier-weight tool than necessary for a narrowly-scoped conflict.
* **Optimistic locking (version column).** Rejected as the sole mechanism: well-suited to protecting concurrent *modifications* of a reservation already in the database (e.g., two staff members approving/editing the same reservation simultaneously — which this ADR also recommends as a *secondary*, complementary technique for reservation update/approval operations, not creation), but does not address the creation-time phantom-insert race by itself.
* **Full `SERIALIZABLE` transaction isolation for all reservation writes.** Rejected: correct but expensive — causes serialization failures and mandatory retries across unrelated bookings platform-wide, hurting the "hundreds of requests per second" throughput target for no additional safety over a correctly-scoped advisory lock.
* **Redis-based distributed lock (e.g., Redlock).** Rejected as the primary mechanism: introduces a second system (Redis) as a correctness-critical dependency for the platform's most important invariant, when PostgreSQL — already the transactional source of truth — can provide the same guarantee natively and atomically within the same transaction as the write itself. Redis remains used for caching/sessions/queues per ARCHITECTURE.md's Database Strategy, not for correctness-critical locking.

### Failure Scenarios and Mitigations

* **Two concurrent bookings for the same table/timeslot.** Second transaction blocks on the advisory lock until the first commits or rolls back; upon acquiring the lock it re-checks availability within the same transaction and raises `ReservationConflictException` if the slot is now taken. No double-booking possible.
* **Application bug bypasses the lock (e.g., a new code path forgets to call the service).** Exclusion constraint at the database level rejects the second insert regardless; the failure is a caught Postgres error mapped to `ReservationConflictException`, not silent data corruption.
* **Long-held lock due to a slow transaction (e.g., a hung external call inside the transaction boundary).** Mitigated by CODING_STANDARDS.md rule: no external I/O (notification dispatch, payment calls) may occur inside the same database transaction as the lock/insert — those are deferred to BullMQ jobs published *after* the transaction commits, keeping the locked transaction short-lived (milliseconds, not seconds).
* **Advisory lock key hash collision** (two different `(branch, table, timeslot)` tuples hashing to the same 64-bit key). Extremely low probability at realistic cardinalities, and even if it occurs, the effect is a harmless false contention (an unrelated booking briefly waits) — never a false negative that would allow a real conflict through, since the post-lock re-check and the exclusion constraint remain authoritative.

### Consequences

#### Positive

* Reservation conflicts are structurally prevented at two independent layers (application lock + database constraint), satisfying the "must never occur" requirement without relying on a single point of correctness.
* Locking is narrowly scoped, preserving horizontal throughput for the overwhelming majority of concurrent requests that don't contend for the same table/timeslot.
* No additional infrastructure dependency — uses PostgreSQL, already the system of record.

#### Negative

* Requires the `btree_gist` PostgreSQL extension to be enabled in every environment (documented in ENVIRONMENT_SETUP.md and the Prisma migration).
* Developers must understand and respect the "no external I/O inside the locked transaction" rule; this must be enforced via code review and documented explicitly in CODING_STANDARDS.md.

### Impact

Affects: Reservation Aggregate, `ReservationAvailabilityService` domain service, Reservation repository/migration (exclusion constraint), Phase 7 (Reservation Engine) implementation, CODING_STANDARDS.md (short-transaction rule), NON_FUNCTIONAL_REQUIREMENTS.md (clarifies how "conflicts must never occur" is technically satisfied).

**Phase 7 pre-implementation decision note (2026-07-19) amendment:** the exclusion constraint's `WHERE` clause is corrected to `status NOT IN ('Cancelled', 'Expired', 'Rejected', 'Pending')` - `Pending` was missing from the original exclusion list, which would have made DOMAIN_MODEL.md's "two overlapping Pending reservations may coexist, resolved at approval time" rule unreachable at the database level (documentation-bug fix, not a new mechanism). New `Table.reserve(reservationId, at)` / `Table.release(at)` domain methods (Phase 7 decision note item 6) call inside the same advisory-locked transaction as the reservation write - `Table.transitionStatus` (Phase 6.3) is unmodified; only these two new methods may set/clear `TableStatus.Reserved`.

**Phase 7.2 implementation note (2026-07-23):** this ADR's own Decision text already required the advisory lock to apply "before inserting a new Reservation **or approving a Pending one**" - `ApproveReservationUseCase` (TASKS.md's "Phase 7.2 — Approval Workflow" report) implements exactly that, plus the "Alternatives Considered" section's recommended secondary optimistic-locking technique (a conditional `WHERE status = 'Pending'` update) for the Approve/Reject/auto-reject write paths. No amendment to this ADR was required - only a correction to an interim readiness report that had mistakenly summarized this ADR as scoped to Create only.

**Phase 7.3 pointer (2026-07-23):** table-changing Reservation Reschedule (Phase 7.3 — Reservation Lifecycle, architecture frozen) introduces a genuinely new concurrency scenario this ADR's single-table lock model does not cover - two physical Tables must be coordinated atomically within one transaction. See **ADR-023** (new, does not alter this ADR's own text) for the deterministic two-key locking protocol that extends this ADR's mechanism for that one operation. Same-table Reschedule and Reschedule-of-`Pending` continue to use this ADR's existing single-key mechanism unchanged.

---

## ADR-014

### Title

GDPR Data Retention and Anonymization Strategy

### Status

Accepted

### Date

2026-07-06

### Context

NON_FUNCTIONAL_REQUIREMENTS.md mandates GDPR-aligned capabilities including an "account deletion workflow," while DATABASE_SCHEMA.md mandates that reservations are never physically deleted and audit logs are immutable. Taken literally, these requirements conflict: deletion implies removing personal data, while retention mandates keeping the records that contain it. A reconciling strategy is required before any User-facing deletion feature (Phase 3/4) is built.

### Decision

Adopt **anonymization-in-place** rather than physical deletion as the mechanism satisfying "account deletion" requests, preserving referential and audit integrity while removing personal data.

Mechanics:

1. **The User row's identity is never physically deleted.** Its UUID primary key persists permanently, preserving every foreign key relationship (`Reservation.userId`, `Review.userId`, `AuditLog.actorId`, etc.) without cascading deletes or orphaned records.
2. **On a verified deletion request**, a domain use case (`AnonymizeUserAccount`) overwrites all direct personal-data fields on the User row: `firstName`/`lastName` → a fixed placeholder (`"Deleted User"`), `email` → a deterministic non-reversible placeholder (`deleted-<uuid>@anonymized.local`) to preserve the unique-email constraint without retaining the real address, `phone` → null, `passwordHash` → invalidated, `avatarId` → null (with the underlying MinIO file queued for deletion via BullMQ). A new `anonymizedAt` timestamp is set and a new `UserStatus.Anonymized` value marks the account as unrecoverable and unable to authenticate.
3. **Reservation, Review, and AuditLog rows are never modified by this process.** They continue to reference the now-anonymized `userId`. Because the User row's PII fields are already scrubbed, any read path that joins to display "who made this reservation" naturally renders the anonymized placeholder — there is exactly one place PII is stored and scrubbed, not many places to hunt down and rewrite.
4. **Configurable retention periods** are stored as `SystemConfiguration` entries per data category (e.g., `auditLogRetentionDays`, `anonymizationGracePeriodDays`) rather than hardcoded, satisfying NON_FUNCTIONAL_REQUIREMENTS.md's "no hardcoded values" and "configurable retention periods" requirements simultaneously. A grace period (default 30 days) allows a user to cancel an accidental deletion request before anonymization executes irreversibly, processed as a delayed BullMQ job.
5. **Data export** (the GDPR right to portability, also required by NON_FUNCTIONAL_REQUIREMENTS.md) is a separate, simpler use case (`ExportUserData`) that compiles the User's own Reservations, Reviews, Favorites, and Preferences into a downloadable structured export before any deletion — offered proactively at the start of the deletion flow.
6. **Consent tracking** is modeled as a `UserConsent` record (timestamp, consent type, version of terms accepted) rather than inferred implicitly, satisfying the "consent tracking" NFR explicitly.

### Alternatives Considered

* **Hard delete the User row with `ON DELETE SET NULL`/cascading on dependent tables.** Rejected: breaks the "reservations are never physically deleted" and "audit logs are immutable" requirements, and destroys referential context needed for financial/legal record-keeping (a reservation or payment record with a null customer reference is a compliance and analytics problem, not a solution).
* **Hard delete the User row while copying PII into a separate "deleted users" archive table for legal retention.** Rejected: doubles the surface area that must be secured/audited and doesn't materially improve over in-place anonymization, while adding an extra table and synchronization risk.
* **Never truly delete anything, only mark `status = deleted`.** Rejected: does not satisfy GDPR's requirement to actually erase personal data upon request — a status flag alone leaves plaintext PII in the database indefinitely.

### Consequences

#### Positive

* Reconciles GDPR erasure obligations with the platform's immutability/audit requirements without contradiction.
* Single source of PII scrubbing (the User row) means no risk of forgetting to scrub a secondary copy.
* Retention periods are configurable per environment/jurisdiction without code changes.

#### Negative

* Requires care in every future feature that stores personal data outside the User table (e.g., a future "ReservationGuest" walk-in record with a name/phone) to anonymize consistently — tracked explicitly as a business rule in DOMAIN_MODEL.md so it isn't missed as new features are added.
* Anonymized accounts still consume a row indefinitely — acceptable, since UUID rows are inexpensive relative to the compliance risk of hard deletion.

### Impact

Affects: User Aggregate, `AnonymizeUserAccount` and `ExportUserData` use cases (Phase 3), SystemConfiguration table (new, see DATABASE_SCHEMA.md), CleanupQueue (BullMQ), DOMAIN_MODEL.md business rules (new GDPR-related rules), NON_FUNCTIONAL_REQUIREMENTS.md (Privacy section clarified).

---

## ADR-015

### Title

WebSocket Horizontal Scaling — Socket.IO Redis Adapter

### Status

Accepted

### Date

2026-07-06

### Context

ARCHITECTURE.md specifies Socket.IO for realtime reservation/table/notification updates and NON_FUNCTIONAL_REQUIREMENTS.md targets 25,000 concurrent WebSocket connections, but no document specifies how Socket.IO behaves once more than one stateless API instance is running. By default, Socket.IO's in-memory adapter only broadcasts events to clients connected to the *same process* — a client connected to instance A never receives a broadcast triggered by instance B. Since NON_FUNCTIONAL_REQUIREMENTS.md separately mandates stateless, horizontally-scaled API servers, this is a near-certain production gap: it will work in single-instance local development and silently drop cross-instance broadcasts the moment a second instance is deployed.

### Decision

Use the **official Socket.IO Redis Adapter** (`@socket.io/redis-adapter`), backed by the same Redis deployment already used for caching/sessions/queues (ADR-004), to propagate WebSocket broadcasts across all API instances.

Architecture:

```
Client (mobile / dashboard)
        ↓ wss://
     Load Balancer / Nginx (Layer 4, WebSocket-upgrade aware, no sticky sessions required)
        ↓
   ┌─────────────┬─────────────┬─────────────┐
   API Instance 1  API Instance 2  API Instance N   (stateless NestJS + Socket.IO gateway)
   └─────────────┴─────────────┴─────────────┘
              ↓ pub/sub            ↓ pub/sub
                   Redis (Socket.IO Adapter channel)
```

1. **Redis Pub/Sub as the broadcast bus.** Each API instance's Socket.IO server connects to Redis using the adapter. When any instance emits an event to a room (e.g., `branch:{branchId}` for table-status updates, `reservation:{reservationId}` for a specific reservation's watchers), the adapter publishes the event to Redis; every instance subscribed to that channel receives and re-emits it to its own locally-connected clients. This makes broadcasts instance-agnostic — application code always calls `server.to(room).emit(...)` without any awareness of which instance a given client is connected to.
2. **No sticky sessions required for correctness**, since any instance can serve any client and still receive all relevant broadcasts via Redis; however, sticky sessions (`ip_hash` or cookie-based) at the load balancer remain a recommended performance optimization to avoid unnecessary Socket.IO HTTP-long-polling fallback handshake overhead on reconnect — not a correctness requirement.
3. **Room-based authorization.** Clients join rooms only after the gateway verifies (via the tenant context from ADR-012 and RBAC) that they are authorized to receive that room's events — e.g., a customer joins `reservation:{their-reservation-id}` only for their own reservations; restaurant staff join `branch:{branchId}` only for branches they're assigned to. This satisfies ARCHITECTURE.md's existing "clients should subscribe only to channels they are authorized to access" rule with a concrete mechanism.
4. **Separate Redis logical database/key prefix** from caching and BullMQ usage, to keep pub/sub traffic isolated from cache eviction and queue operations for observability and to avoid key collisions (all three uses share the same Redis deployment per ADR-004, differentiated by database index or key namespace).

### Alternatives Considered

* **Sticky sessions only, no Redis adapter.** Rejected: does not solve cross-instance broadcast (an event triggered by a REST API call on instance A still needs to reach a WebSocket client connected to instance B) — sticky sessions solve client-to-instance affinity, not server-to-server event propagation, so this alone is insufficient.
* **A dedicated message broker (Kafka/RabbitMQ/NATS) for WebSocket propagation.** Rejected for v1: over-engineered for the current need — introduces a new infrastructure dependency when Redis, already present, natively supports this exact pattern via its adapter. DECISIONS.md's Future Decisions list already tracks "message broker adoption" as a separate future concern (e.g., for cross-service domain events during a future microservices migration), which is a distinct problem from WebSocket fan-out.
* **Single dedicated WebSocket-only service (not horizontally scaled).** Rejected: creates a single point of failure and a scaling bottleneck at exactly the connection count (25,000 concurrent) the NFRs target; contradicts the "stateless, horizontally scalable" architectural principle applied to every other component.

### Consequences

#### Positive

* WebSocket broadcasts work correctly regardless of how many API instances are running or which instance a client is connected to.
* No new infrastructure dependency — reuses the existing Redis deployment.
* Room-based authorization gives a concrete, auditable mechanism for the existing "authorized clients only" rule.

#### Negative

* Adds Redis as a hard dependency for realtime correctness, not just performance (if Redis is unavailable, cross-instance broadcasts stop working, though same-instance delivery continues) — mitigated by Redis's own recommended HA setup (replication/sentinel), tracked under NON_FUNCTIONAL_REQUIREMENTS.md's existing High Availability section.
* Requires monitoring Redis pub/sub throughput as a distinct metric from cache hit ratio, since a WebSocket fan-out spike (e.g., a popular restaurant's table map updating rapidly) produces different load characteristics than cache access.

### Impact

Affects: ARCHITECTURE.md (Realtime Architecture section), Infrastructure layer (`infrastructure/websocket` module), Phase 8/9 implementation, NON_FUNCTIONAL_REQUIREMENTS.md (Observability section — new pub/sub metrics), EVENTS.md (room-naming convention).

---

## ADR-016

### Authentication & Session Strategy

Status: Accepted (Phase 2.0 Architecture). **Partially superseded by ADR-022** (2026-07-22) for two specific clauses only — item 4's email-verification gate no longer applies to (a) customer/`User` registration (replaced by phone/WhatsApp verification) or (b) administratively-provisioned Restaurant Owner accounts (no verification step at all). All other ADR-016 mechanics — dual actor model, opaque refresh rotation, short-lived access JWT, Argon2id, the two RBAC layers, tenant context binding — remain fully Accepted and unchanged. This Status line is the only part of this ADR touched by ADR-022, per this document's immutability rule (§ "Rules" below; same convention as ADR-009's `Superseded by ADR-011 and ADR-012` annotation).

Date: 2026-07-07

#### Context

Phase 2 requires a concrete authentication and session design before implementation. Prior documents stated "JWT + Refresh Tokens + Argon2 + RBAC" (ARCHITECTURE.md, NON_FUNCTIONAL_REQUIREMENTS.md) without specifying token shape, rotation, dual actor model (customer vs staff), or how RBAC layers interact with TENANCY.md.

#### Decision

1. **Dual actor model** — JWT `actorType` discriminates `User` (customer), `Employee` (restaurant operational staff), and `OrganizationMember` (org administration). Claims are shaped per actor; `organizationId` is present only when the actor operates in a tenant context.
2. **Opaque refresh tokens with rotation** — refresh tokens are 256-bit random strings, stored as SHA-256 hashes in `DeviceSession`. Every refresh rotates the token. Presenting a rotated token revokes the entire `tokenFamilyId` (theft detection).
3. **Short-lived access JWT** — 15-minute HS256 JWT (Phase 2); permissions embedded for `Employee` actors with `permissionsVersion` for staleness detection on refresh. No access-token blocklist in Phase 2.
4. **Email verification gate** — no tokens issued at registration; login requires `emailVerified` and `status = Active`.
5. **Argon2id** — password hashing via configurable `ARGON2_*` parameters; `PasswordHasher` port in Domain.
6. **Two RBAC layers** — `OrganizationMember.role` enum for org administration; `Roles` + `Permissions` + `RolePermissions` for restaurant operations. No `UserPermission` table.
7. **Tenant context** — `TenantContextInterceptor` binds `organizationId` from JWT after `JwtAuthGuard`; never from request input (ADR-012, TENANCY.md).

Full specification: **AUTHENTICATION_ARCHITECTURE.md**.

#### Alternatives Considered

* **Refresh token as JWT** — rejected: harder to revoke instantly and encourages long-lived signed tokens in client storage.
* **Redis-only sessions** — rejected: violates DATABASE_SCHEMA.md policy that persistent auth state lives in PostgreSQL; Redis used for rate limits only.
* **Permission lookup on every request** — rejected per NON_FUNCTIONAL_REQUIREMENTS.md; permissions in JWT with version invalidation on change.
* **Single RBAC model for org + restaurant** — rejected: org admin roles (Owner, Billing) are not operational permissions and would pollute the Permissions seed.

#### Consequences

* Positive: Clear implementation path; aligns with TENANCY.md and DOMAIN_MODEL.md; rotation detects theft.
* Negative: Permissions may be stale for up to access-token TTL after role change; mitigated by `permissionsVersion` on refresh.
* Negative: Owner registration creates Organization in auth flow — tight coupling mitigated by explicit `intent=owner` and Phase 4 still owns Restaurant creation.

#### Impact

Affects: `modules/authentication/`, `infrastructure/tenancy/`, DATABASE_SCHEMA.md (auth tables), EVENTS.md, API_GUIDELINES.md, ENVIRONMENT_SETUP.md, TESTING_STRATEGY.md.

---

## ADR-017

### Authorization Strategy

Status: Accepted (Phase 2.0.1 Architecture)

Date: 2026-07-07

#### Context

ADR-016 defined authentication (identity, sessions, JWT) but embedded RBAC resolution (`EmployeeAccessResolver`), permission guards, and JWT permission claims in the authentication design. Authorization must evolve independently to support ABAC, subscription limits, feature flags, temporal permissions, and domain policies without redesigning authentication.

#### Decision

1. **Strict separation** — `authentication` module proves identity only (`JwtAuthGuard`, `SessionVersionGuard`). `authorization` module owns all entitlement checks (guards, `PermissionResolver`, `PolicyEngine`, domain policies).
2. **RBAC as foundation** — two layers retained: `OrganizationMember.role` (org admin) and `Roles`/`Permissions`/`RolePermissions` (restaurant ops). No separate `UserPermission` table; employee overrides use `RolePermissions.employeeId`.
3. **Policy Engine** — domain policies (`ReservationPolicy`, `TablePolicy`, …) expose `authorize(actor, action, context)`; use cases call policies, never embed role checks.
4. **Permission versioning** — `permissionsVersion` on `User`/`Employee`; embedded in JWT; re-resolved on refresh only; no long-lived permission Redis cache.
5. **Session versioning** — `sessionVersion` on `User`; global logout increments version; all JWTs with stale `sessionVersion` rejected without per-session revocation.
6. **Token families** — `TokenFamily` entity (FK `tokenFamilyId` on `DeviceSession`) groups refresh rotation chains; reuse revokes family.
7. **Scope guards** — branch and organization scope are authorization concerns, distinct from tenant isolation (TENANCY.md).
8. **Future extensibility** — ABAC, `PermissionAssignment` (temporary grants), feature flags, and subscription limits integrate via Policy Engine evaluation order; no schema redesign required.

Full specification: **AUTHORIZATION_ARCHITECTURE.md**.

#### Alternatives Considered

* **Single auth module for identity + permissions** — rejected: couples session rotation to policy changes; prevents independent testing and evolution.
* **`UserPermission` table** — rejected: duplicates `RolePermissions` employee overrides; org admin uses enum; ABAC uses future `PermissionAssignment`.
* **Redis permission cache** — rejected for Phase 2: stale permissions after role change; versioned JWT + refresh is sufficient.
* **PostgreSQL RLS for authorization** — rejected: authorization is business rules + RBAC, not row ownership alone (tenant isolation already separate per ADR-012).

#### Trade-offs

| Choice | Benefit | Cost |
|---|---|---|
| Separate modules | Clear boundaries, testable | Two modules to wire in Phase 2 |
| JWT permission embedding | Fast requests | Up to 15 min staleness |
| Session version global logout | O(1) logout-all | All devices disconnected |
| Policy classes per domain | Clean use cases | More files; registry discipline |

#### Consequences

* Positive: Authentication implementation (Phase 2.1+) does not need Policy Engine; Authorization can ship incrementally (2.13+).
* Positive: Feature modules depend on policy interfaces — framework-agnostic domain.
* Negative: Two version counters (`sessionVersion`, `permissionsVersion`) — must document clearly in JWT claims.
* Migration: `EmployeeAccessResolver` moves under `authorization` module; TENANCY.md references updated.

#### Future Evolution

* ABAC rules via `AuthorizationRule` table and Policy Engine attributes.
* `Roles.parentRoleId` for role inheritance.
* Optional Redis cache keyed by `permissionsVersion`.
* Emergency lockdown via `SystemConfiguration`.
* Country and time-based restrictions in policy layer.

#### Impact

Affects: `modules/authorization/` (new), `modules/authentication/` (slimmed), DOMAIN_MODEL.md, DATABASE_SCHEMA.md, EVENTS.md, AUTHENTICATION_ARCHITECTURE.md, ARCHITECTURE.md, TENANCY.md.

---

## ADR-018

### Search & Restaurant Discovery Strategy

Status: Accepted (Architecture Compliance Audit 2026-07-07)

Date: 2026-07-07

#### Context

The product requires restaurant search, nearby discovery, taxonomy filters (cuisine, occasion, price), and comparison APIs (`PRODUCT_REQUIREMENTS.md` FR-07). No ADR previously defined the search implementation path; `RestaurantSearchService` existed in DOMAIN_MODEL.md without a persistence/query strategy.

#### Decision

1. **Phase 1 (≤ ~5,000 restaurants):** PostgreSQL-only discovery — `ILIKE`/trigram indexes on `Restaurants.name`, taxonomy joins (`CuisineCategory`, `OccasionCategory`), `priceLevel` filter, branch `latitude`/`longitude` bounding-box queries for nearby.
2. **Phase 2 (scale trigger):** Optional dedicated search engine (OpenSearch/Elasticsearch) as a **read-side projection** fed by domain events (`RestaurantCreated`, `RestaurantUpdated`, `BranchUpdated`). PostgreSQL remains source of truth.
3. **Comparison API:** Stateless `POST /restaurants/compare` accepting 2–5 restaurant IDs; returns normalized comparison DTO (ratings, price, cuisine tags, distance if geo context supplied). No extra tables.
4. **Public vs authenticated:** Search/nearby endpoints are public with rate limiting per `API_GUIDELINES.md`; favorites and personalized ranking deferred to client or future recommendation service.
5. **Partner/Public API:** REST `/api/v1` remains canonical; partner integrations use the same DTOs with API-key auth (future `PartnerApiKey` table — not Phase 2).

#### Alternatives Considered

* **External search engine from day one** — rejected: operational cost and dual-write complexity before scale warrants it.
* **Single `cuisineType` string only** — rejected: insufficient for multi-cuisine restaurants and filter UX.
* **GraphQL as primary API** — rejected for Phase 1; REST + OpenAPI is the contract (GraphQL optional future gateway).

#### Consequences

* Positive: No redesign required to add OpenSearch later; taxonomy tables support rich filters now.
* Negative: Geo queries on PostgreSQL require careful indexing; GiST migration may be needed at scale (Phase 15).
* Impact: `DATABASE_SCHEMA.md` (taxonomy tables), Phase 4–5 migrations, `modules/discovery/` (future module name).

**Phase 15.5 pre-implementation decision note (architecture frozen 2026-07-29, owner-approved; implemented, Docker-dependent-verified, and production-verified 2026-07-30 — see `TASKS.md`'s "Phase 15.5 — Discovery Module: Implementation & Verification Report"):** the following freezes this ADR's Phase 1 parameters for the Discovery Module; no decision item above changes, and no new ADR was required (`CHANGE_POLICY.md`'s ten mandatory-ADR triggers were re-evaluated and none apply — this implements decision items 1/3/4 above exactly as already accepted).

1. **Search identity:** Restaurant-rooted results. A Restaurant appears once per search regardless of branch count; a nearby search attaches `nearestBranch`/`distanceKm` computed from the nearest qualifying (Active, non-deleted, coordinate-populated) Branch within the requested radius.
2. **Location source:** both client-supplied `lat`/`lng` and city-text search are supported; no IP geolocation, no server-derived device location.
3. **Nearby algorithm:** PostgreSQL bounding-box prefilter on the existing `(latitude, longitude)` B-tree index (Phase 5.3), refined by an in-query Haversine distance calculation for exact-radius exclusion and ordering. No PostGIS, `earthdistance`/`cube`, or GiST in this phase — GiST remains attributed to Phase 15 (Optimization), "when query volume warrants," unchanged from this ADR's own Consequences line above. Default radius 5km, max radius 50km, kilometers throughout, `distance ASC` default order with `restaurantId ASC` as the deterministic tie-breaker.
4. **Text search:** `ILIKE '%q%'` against `Restaurant.name` only for v1 — no `pg_trgm`/GIN index, no external search provider. Trigram/external-index evaluation remains Phase 15 (Optimization)'s "Search Index Evaluation (ADR-018 Phase 2 trigger)" item, not reopened here.
5. **Taxonomy:** cuisine/occasion filtering uses the relational `CuisineCategory`/`RestaurantCuisineCategory` (and `OccasionCategory` equivalent) taxonomy exclusively. `Restaurant.cuisineType` (freeform string) remains legacy/display-only, not OR'd into filtering, not migrated or removed in this phase.
6. **Comparison API:** implemented as part of this phase, exactly as decision item 3 above already specifies (stateless, 2–5 restaurant IDs, no persistence) — finalized under the Discovery route namespace (`POST /discovery/restaurants/compare`) rather than a top-level `/restaurants/compare` route, to keep the public search surface under one Swagger tag/module.
7. **Rate limiting:** decision item 4's "public with rate limiting" is now concretely frozen — see `API_GUIDELINES.md`'s Rate Limiting section and `TASKS.md`'s Phase 15.5 decision note for the exact tier. Reuses the existing Redis sliding-window algorithm/primitive (`RateLimiterPort`); implemented as a new, Discovery-scoped policy rather than extending Authentication's own closed `RateLimitPolicyName` union, to avoid coupling an unrelated bounded context into Authentication's policy registry — same mechanism, not a second rate-limiting architecture.
8. **Public FloorPlan/Table projection correction:** the already-shipped (2026-07-28) `GET /discovery/restaurants/:id/branches/:id/floor-plan` endpoint was found, during this freeze's audit, to reuse the internal Owner/Admin `TableResponseDto` verbatim, exposing `mergeGroupId`/`isMergePrimary`/operational `status`/timestamps publicly. This is corrected as part of Phase 15.5 implementation via a dedicated customer-safe projection (see `TASKS.md`'s Phase 15.5 decision note for the exact frozen field list) — a restoration of the customer-safe intent this document and `TENANCY.md` already assumed, not a scope expansion into Table/Merge-Split redesign.

---

## ADR-019

### Reservation Waitlist & Operational Signals

Status: Accepted (Architecture Compliance Audit 2026-07-07)

Date: 2026-07-07

#### Context

Product scope includes reservation waiting list, reminders, late-arrival handling, and table-ready notifications. Only core reservation lifecycle was previously specified.

#### Decision

1. **`ReservationWaitlistEntry`** — separate table/aggregate from `Reservation`; promoted atomically to `Reservation` via `WaitlistPromotionService`.
2. **Reminders** — BullMQ delayed jobs keyed by `reservationId` + reminder offset from `RestaurantSettings`; cancelled on reservation cancel/reschedule.
3. **Late arrival** — staff action or grace-period job emits `GuestLateArrivalNotified`; `lateArrivalNotifiedAt` prevents duplicates.
4. **Table ready** — staff marks table ready → `TableReadyNotified` → push/SMS to guest; `tableReadyNotifiedAt` prevents duplicates.
5. **Walk-in** — `Reservation.source = WalkIn` with `ReservationGuest`; same ADR-013 concurrency rules.

#### Consequences

* Positive: Clear separation between booked reservations and queue state.
* Negative: Additional queue management UI and position recomputation logic.
* Impact: Phase 7–9, `DATABASE_SCHEMA.md`, `EVENTS.md`, `DOMAIN_MODEL.md`.

**Phase 7 pre-implementation decision note (2026-07-19) amendment:** mapped to sub-phases - waitlist itself is **Phase 7.5** (automatic promotion trigger on `ReservationCancelled`/`ReservationNoShow`/`ReservationExpired`, plus manual staff trigger); reminders/late-arrival/table-ready are **Phase 7.6**, with `GuestLateArrivalNotified`/`TableReadyNotified` confirmed as real domain event classes (named `NotificationDispatcher` consumer already documented here), not audit-only.

**Phase 7.5 implementation decision note (architecture frozen 2026-07-24, implemented and live-verified same day) — supersedes the sub-phase amendment above where noted:**

1. **Join requires `preferredDate` AND `preferredTimeFrom`** at the API boundary (`POST /waitlist`); `preferredTimeFrom` is the **authoritative** requested Reservation start time-of-day on promotion, not merely a soft preference (the original ADR-019/DATABASE_SCHEMA.md text calling it "soft" is superseded). `preferredTimeTo` remains optional and non-authoritative (filtering metadata only, never used to construct a Reservation).
2. **Slot derivation**: `reservationStartTime = (preferredDate, preferredTimeFrom)` interpreted in `Branch.timezone`, converted to UTC via the runtime's own `Intl.DateTimeFormat` (no third-party timezone dependency); `reservationEndTime = reservationStartTime + RestaurantSettings.defaultReservationDurationMinutes`. `RestaurantSettings.timezone` is never used. A request whose derived start time is already in the past is rejected at Join, and an entry that later becomes past-due is simply left `Waiting`/`Notified` (never reinterpreted as "seat now") until its own expiration fires.
3. **Expiration**: end of `preferredDate` (23:59:59.999) in `Branch.timezone`, converted to UTC - unaffected by `preferredTimeFrom`/`preferredTimeTo`. Scheduled via a dedicated `WaitlistQueue` BullMQ delayed job, direct structural mirror of Phase 7.3's `ReservationQueue` expiration mechanism (same idempotent conditional-transition guard, same deterministic-`jobId`/dash-separated-id precedent).
4. **State machine (frozen)**: `Waiting -> {Notified, Converted, Cancelled, Expired}`, `Notified -> {Converted, Cancelled, Expired}`; `Converted`/`Cancelled`/`Expired` terminal; `Notified -> Waiting` not allowed; `Waiting -> Converted` valid directly (notification is not a promotion prerequisite).
5. **Table selection (promotion)**: never the triggering Reservation's own table - a fresh informational search (`TableRepository.findManyAvailableByBranchIdAndMinCapacity` + `ReservationRepository.findOverlappingPendingOrApproved`, the same building blocks `SearchAvailabilityUseCase` already uses) against the entry's own derived window, smallest-sufficient-capacity first, `tableNumber` ascending as tie-break. ADR-013 remains the sole transactional concurrency authority; the search is informational only.
6. **Automatic trigger set (corrects the original "Cancelled/NoShow/Expired" framing above)**: only `Approved -> Cancelled` and `Approved -> NoShow` trigger a re-check - both are the only transitions that actually call `Table.release()`. `Pending -> Cancelled` and `Pending -> Expired` never held a table and do not trigger one.
7. **Automatic re-check delivery**: a durable, BullMQ-enqueued `WaitlistRecheckQueue` job (not a bare synchronous call) - `ReservationsModule` registers the producer (`BullMqWaitlistRecheckScheduler`, called from `CancelReservationUseCase`'s `Approved` branch and `MarkNoShowReservationUseCase` after their own transaction commits, best-effort/non-blocking relative to that action) and `WaitlistModule` independently registers the consumer (`WaitlistRecheckProcessor`) for the same queue name - two ordinary BullMQ producer/consumer registrations, not a circular NestJS module import.
8. **FIFO fairness — FIFO-ORDERED FIRST-SERVICEABLE**: the re-check scan evaluates active entries strictly in `position` order and promotes the first one that is actually serviceable; an unserviceable head-of-queue entry does not block later entries and is never mutated (no cancel/expire/reorder) by being skipped. At most one successful promotion per re-check attempt.
9. **Promotion ownership**: `WaitlistPromotionService` reuses `ReservationRepository.createWithLockInTransaction` directly (never `CreateReservationUseCase`). A two-phase database claim (status-only first, `convertedReservationId` attached second, once the Reservation row exists) is required because that column carries a real FK to `reservations.id` and the target row does not exist at claim time - discovered and fixed via live concurrency testing (two-phase claim, same transaction, same atomicity guarantee).
10. **`Reservation.createdBy` is now `string | null`** - `null` means an automatic (System) Waitlist promotion created the Reservation; every other path (Online/Phone/WalkIn/Staff, manual Waitlist promotion) still always sets a real actor id. `AuditingEventPublisher`'s `ReservationCreatedEvent` attribution is three-way: `userId` set → `User`; `userId` null & `createdBy` set → `Employee`; both null → `System`.
11. **`reservations:waitlist` permission** - covers Join-on-behalf-of-guest, Cancel (Employee branch), and manual Promote; granted to `manager`/`receptionist`, not `cashier`.
12. **Tenancy correction (supersedes the schema shape implied by this ADR's original "separate table/aggregate" decision item 1)**: `ReservationWaitlistEntry` carries **no** direct `organizationId` column, despite the pre-implementation `DATABASE_SCHEMA.md` draft specifying one. A required direct `organizationId` is structurally incompatible with Customer-facing Join: a Customer actor has no bound `TenantContext.organizationId`, and `Restaurant` (the only path to discover one via `branchId -> Branch.restaurantId -> Restaurant.organizationId`) is a `DIRECT_TENANT_OWNED_MODEL`, fail-closed with no context bound (`TenantContextMissingException`) - there is no legitimate way to populate the column for a Customer-initiated row without bypassing tenant scoping, which was explicitly rejected. Tenant ownership is instead resolved transitively, exactly like `Reservation` itself already does; `ReservationWaitlistEntry` remains unregistered in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`. A forward corrective migration (`20260724143130_phase_7_5_1_waitlist_remove_organization_id`) dropped the column after the original Phase 7.5 migration had already been applied - no data existed yet, a clean lossless drop.

**Phase 7.6 implementation amendment (architecture frozen 2026-07-24, implemented same day) — domain/event scope only, per this ADR's own decision items 2-4:**

1. **Reminder/Late-Arrival offsets live on `RestaurantSettings`**, not hardcoded: `reservationReminderMinutesBefore` (default 60, 1-10080) and `lateArrivalGraceMinutes` (default 15, 1-1440) - two new dedicated queues (`ReminderQueue`, `LateArrivalQueue`) rather than one shared queue, keyed `reservation-reminder-{id}`/`reservation-late-{id}`, scheduled/re-timed/cancelled through one new `ApprovedReservationOperationalSchedulerPort` wrapped by `ScheduleApprovedReservationSignalsService`, wired post-commit into Approve/Create-auto-approve/Waitlist-promotion-auto-approve (schedule), Reschedule-while-Approved (replace), and Cancel/Complete/NoShow-from-Approved (cancel).
2. **`ReservationReminderDue`/`GuestLateArrivalNotified` confirmed real event classes (per decision item 2/3 above), System-attributed**; a stale Reminder job (one that survived a reschedule without being correctly re-timed) is a no-op, guarded by re-checking the reservation's current `status`/`reservationStartTime` against the job's own captured values - it does not blindly fire. `markLateArrivalNotifiedIfEligible`'s repository-level CAS (`WHERE status = 'Approved' AND lateArrivalNotifiedAt IS NULL`) is the sole eligibility gate for the late-arrival job, proven race-safe against real concurrent Postgres transactions.
3. **Table Ready is staff-initiated only (`POST /reservations/:id/table-ready`, new `reservations:tableready` permission), never a scheduled job** - decision item 4's "staff marks table ready" is implemented exactly as written; the "push/SMS to guest" half of that item remains Phase 9 (`NotificationProvider`) scope, not built here. Unlike the background jobs, a CAS failure here is a staff-facing 400, not a silent no-op.
4. **`ReservationReminderSent` and `WaitlistEntryNotified`'s production path both remain explicitly deferred to Phase 9** - this ADR's own decision items are satisfied by "Due" (computed/scheduled) and "Notified" (Employee-confirmed) signals; actual notification *delivery* confirmation is a `NotificationProvider` concern this phase does not implement, per the Phase 7.6 checklist's own scope note.

No new ADR was required for the above - all four items implement already-accepted decision items 2-4 of this ADR exactly as specified (CHANGE_POLICY.md's "not required" carve-out).

---

## ADR-020

### Customer–Restaurant Messaging (Chat)

Status: Accepted (Architecture Compliance Audit 2026-07-07)

Date: 2026-07-07

#### Context

In-app chat between customers and restaurant staff is required (`PRODUCT_REQUIREMENTS.md` FR-16). No prior schema or event specification existed.

#### Decision

1. **`Conversation` / `ConversationParticipant` / `Message`** tables — tenant-scoped via `organizationId`.
2. **Real-time** — `MessageSent` WebSocket event to `conversation:{id}` room; Redis adapter per ADR-015.
3. **Authorization** — `ConversationPolicy`; customers access only threads they participate in.
4. **Optional `reservationId`** — links chat to a booking without merging aggregates.
5. **Attachments** — via `Files` + `attachmentFileId` on `Message`; virus scan in infrastructure layer.

#### Alternatives Considered

* **Third-party chat SDK only** — rejected: tenant isolation and reservation linkage require first-party data model.
* **Messages embedded in `Reservations.notes`** — rejected: not real-time, no multi-party staff visibility.

#### Consequences

* Impact: New `modules/messaging/` bounded context; Phase 9+ implementation after auth/restaurant foundation.

**Phase 15.6 Messaging — Owner Decisions (D1–D15) (architecture designed 2026-07-30, this implementation session):** an earlier task brief asserted these decisions, plus an "ADR-030" tenancy correction, were already frozen via a prior architecture-audit/owner-decision/freeze cycle. No such record existed anywhere in this document, `TASKS.md` (Phase 15.6 was `⏳ Pending`, all items unchecked), or `PROJECT_ROADMAP.md` (no Phase 15.6 section at all) before this session. Rather than implement against a fabricated decision history, the following freezes ADR-020's remaining open parameters now, transparently, as new decisions made in this session at the owner's direction. Item 1 formalizes the tenancy correction recorded as **ADR-030** below; items 2–15 are new decisions this ADR did not specify at implementation-ready granularity.

1. **Tenancy** — see ADR-030. `Conversation`/`ConversationParticipant`/`Message` carry `restaurantId` only; no `organizationId` column; resolved transitively via the already-tenant-scoped `RestaurantRepository`, exactly like `Branch`/`Reservation`/`Review`/`Offer` (`TENANCY.md`).
2. **`ConversationParticipant` shape** — per-individual rows, matching `DATABASE_SCHEMA.md`'s existing placeholder: `role` (`Customer`, `Staff`, `System`), `userId` (nullable), `employeeId` (nullable FK → `Employee`). A `Customer` row always sets `userId` (their own `User.id`), `employeeId` null. A `Staff` row set by an `Employee` sender sets `employeeId`, `userId` null; a `Staff` row set by an `OrganizationMember` sender sets `userId` to their own `User.id`, `employeeId` null (distinguishing the two is why `Message.senderType`, D3, exists — a bare `Staff` participant row with only `userId` set is structurally ambiguous with a `Customer` row unless `role` is also read). Rows are created lazily on first interaction (send or explicit read), each with its own `lastReadAt` — real per-person read receipts, not a single shared "restaurant side" flag. No guest (`ReservationGuest`) participants — messaging requires a registered `User`. Authorization for *which* `Employee`/`OrganizationMember` may act as Staff at all is resolved by D15, independent of whether a participant row yet exists.
3. **`Message` sender attribution** — `senderType` (`Customer | Employee | OrganizationMember | System`) plus `senderUserId` (nullable) / `senderEmployeeId` (nullable FK → `Employee`), mirroring `resolveTableManagementActorId`'s dual resolution (`apps/backend/src/modules/tables/application/services/assert-actor-can-manage-tables.ts`): an `Employee` sender populates `senderEmployeeId`; an `OrganizationMember` sender populates `senderUserId` with their own `User.id` (there is no `Employee` row for them); a `Customer` sender populates `senderUserId`. The `senderUserId` XOR `senderEmployeeId` invariant (for non-`System` senders) is a database `CHECK` constraint added via raw SQL in the migration, exactly like `Reservation.userId`/`reservationGuestId` and `ReservationWaitlistEntry` — Prisma's schema language cannot express it directly, so it is not written in `schema.prisma` itself. `senderType` is additionally validated in the `Message` domain entity constructor (it disambiguates which of the two same-shaped XOR cases applies — a DB `CHECK` alone cannot tell a Customer's `senderUserId` from an OrganizationMember's).
4. **Optional `reservationId`** — unchanged from ADR-020 item 4: nullable, no cascading behavior, soft link only.
5. **Conversation status** — `ConversationStatus { Open, Closed, Archived }`, one column (no separate `archivedAt`). `POST /conversations/:id/close` is actor-branched, reusing the single endpoint rather than adding a ninth route: a `Restaurant`-side actor (`Employee`/`OrganizationMember`) sets `Closed` (closes for both sides); the `Customer` participant sets `Archived` (soft-hides from their own default `ListCustomerConversations` view only — staff visibility/list unaffected). Sending a new `Message` to a `Closed` or `Archived` conversation auto-transitions it back to `Open` from either side — closing/archiving is a convenience signal, not a hard lock.
6. **Notifications** — customer-only, per the existing `NotificationDispatcher` precedent (`apps/backend/src/modules/notifications/application/services/notification-dispatcher.service.ts`), which has no staff notification path at all. When a `Restaurant`-side sender (`Employee` or `OrganizationMember`) sends a `Message`, exactly one `Notification` is dispatched to the `Customer` participant's `userId` via the existing `NOTIFICATION_PROVIDER`/dispatcher pipeline. A `Customer`-sent `Message` never triggers a `Notification` (staff visibility is realtime-only, per D9). No `Employee`/`OrganizationMember` ever receives a `Notification` row for messaging.
7. **`FileOwnerType`** — add `Message` as a fifth enum value (`User | Restaurant | Review | Menu | Message`) alongside the TS union in `apps/backend/src/modules/files/domain/entities/file-record.entity.ts`. `Message.attachmentFileId` is a plain UUID pointer (no Prisma relation, consistent with `File`'s existing polymorphic `ownerId`/`ownerType` design). Upload flow mirrors `AddReviewImageUseCase` (`apps/backend/src/modules/reviews/application/use-cases/add-review-image.use-case.ts`) exactly: resolve+own-check the parent `Conversation` first, validate file, `StoragePort.upload()`, `FileRepository.create({ ownerType: 'Message', ownerId: message.id, ... })` with compensating delete on failure. No virus scanning in this phase (ADR-020 item 5's "virus scan in infrastructure layer" remains a future hardening item, not a blocker here).
8. **Rate limiting** — new `MESSAGING_RATE_LIMITER` DI token bound to the existing `RedisSlidingWindowRateLimiter` (`RateLimiterPort`), following Discovery's precedent of binding its own token rather than reusing Authentication's closed `RateLimitPolicyName` union (`apps/backend/src/modules/discovery/presentation/guards/discovery-rate-limit.guard.ts`). Keyed per participant (`messaging:ratelimit:send:{participantKey}`, where `participantKey` is the resolved actor id from D15/D3). Applied only to `SendMessage`; reads use the standard global HTTP tier only.
9. **Realtime** — extend `RoomType` (`apps/backend/src/modules/realtime/application/room.ts`) with `Conversation` — the addition its own doc comment anticipated and gated behind "a new architecture freeze"; this decision note is that freeze. Add `authorizeConversation(actor, conversationId)` to `RoomAuthorizationService`, dual-branching: `User` must be the conversation's `Customer` participant (`userId` match); `Employee`/`OrganizationMember` must pass the same D15 check used for `SendMessage`. Extend `realtime-event-mapping.ts` with `ConversationStarted`/`MessageSent`/`MessageRead`/`ConversationClosed`, broadcasting only to `conversation:{conversationId}`. No regression to the existing four `RoomType` values.
10. **GDPR** — `Message.anonymizedAt` (nullable `DateTime`), mirroring `User.anonymizedAt`/`ReservationGuest.anonymizedAt`. Per-message (not per-conversation or per-participant) because `Message.body` is the PII-bearing content and a conversation may retain one anonymized participant's history while the other's remains intact. No erasure job implemented in this phase — same "anonymization-compatible; no erasure subsystem yet" posture already accepted for `User`/`ReservationGuest`.
11. **Archival visibility** — `ListCustomerConversations` excludes `status = Archived` by default, with an explicit `includeArchived` query filter to show them; `ListRestaurantConversations` is unaffected by `Archived` (staff always see it, since D5 confines the meaning of `Archived` to the customer's own view). No separate `archivedAt` column — folded into `status` per D5.
12. **Idempotency** — no generic `Idempotency-Key` handling exists anywhere in the codebase today. This phase introduces one, scoped to `POST /conversations` and `POST /conversations/:id/messages`: a small `IdempotencyStorePort` backed by the same Redis connection `RateLimiterPort` already uses (reuses existing Redis infrastructure, not a new subsystem), storing `(idempotencyKey, actorId) → response` for 24h and replaying it verbatim on retry instead of re-executing the command.
13. **Pagination** — cursor-based (`(createdAt, id)` keyset) for `GET /conversations/:id/messages` and the two conversation-list endpoints, default page size 50 / max 100. A deliberate new convention for this codebase (every existing list endpoint uses page/limit offset pagination per `API_GUIDELINES.md`) — justified because message history is an append-heavy, high-churn feed where offset pagination double-counts/skips rows under concurrent inserts. Documented as a one-off precedent, not a retroactive change to any other module's pagination.
14. **Cross-tenant/cross-branch denial** — IDOR-safe, matching `assertActorCanManageTables`/`assertEmployeeCanActOnReservation` exactly: an unresolvable `restaurantId`/`conversationId` (wrong org, wrong branch scope for `Employee`, or not a participant for `Customer`) resolves to `ConversationNotFoundException` (404); a resolvable-but-insufficient actor (right org/branch, wrong role/permission) resolves to `PermissionDeniedException`/`EmployeeBranchNotAssignedException` (403). Never a distinguishing error that reveals existence to an unauthorized caller.
15. **Dual Actor authorization** — `Employee` (branch-scoped, new `conversations:manage` permission — no existing slug fits, unlike Analytics' reuse of `reports:view`) **or** `OrganizationMember` (org-scoped, `Owner`/`Admin` role only) may act as the `Restaurant` side, exactly the `assertActorCanManageTables`/ADR-026/ADR-028 shape: routes wear only `JwtAuthGuard` + `SessionVersionGuard`; a new `assertActorCanManageConversation(actor, restaurantId, branchId)` + `resolveMessagingActorId(actor)` pair, called from inside each staff-facing use case, does the branching. No third authorization model invented. `Customer` (`User`) side is single-actor: ownership check only (`conversation.customerParticipant.userId === actor.userId`).

---

## ADR-021

### Billing Invoices

Status: **Superseded — Withdrawn by Owner Product-Scope Decision (2026-07-28).** TAVLA will not process payments in-app; this ADR's invoice/payment design will not be implemented. Preserved below for historical record only — do not implement.

Date: 2026-07-07 (Accepted) → 2026-07-28 (Withdrawn)

#### Context

Subscriptions and payments were modeled (`Payments`, `PaymentTransactions`) but invoice documents for organizations were absent from the schema.

#### Decision

1. **`Invoices` table** — metadata + `lineItems` jsonb; PDF stored in MinIO via `Files.pdfFileId`.
2. **Generation** — triggered on `PaymentSucceeded` or subscription renewal job; idempotent on `paymentId`.
3. **Numbering** — `invoiceNumber` unique per `organizationId`; format configurable via `SystemConfiguration`.
4. **Provider invoices** — optional `providerInvoiceId` when payment provider supplies its own document (Stripe invoice ID, etc.).

#### Consequences

* Payment provider ADR (provider selection) remains open; invoice structure is provider-agnostic.
* Impact: Phase 13, `DATABASE_SCHEMA.md`, `EVENTS.md`.

#### Disposition (2026-07-28)

Owner decision: TAVLA does not process customer or reservation payments inside the platform, permanently. No `Payments`, `PaymentTransactions`, or `Invoices` table was ever implemented in Prisma — this ADR was never carried into code, so its withdrawal removes no production functionality. `Payments is Phase 13` and `Phase 13 — Payments` are removed from the roadmap as planned work; see `TASKS.md` and `PROJECT_ROADMAP.md`. Invoice document generation will not be built. Restaurants may handle financial settlement independently, outside TAVLA.

---

## ADR-022

### Phone/WhatsApp-First Customer Registration (Fonnte) & Administratively-Provisioned Restaurant Owners

Status: **Accepted — Architecture Frozen. Implementation COMPLETE, live-verified, production-verified (Phase 2.23, 2026-07-22 — see `TASKS.md`'s Phase 2.23 closure report).**

Date: 2026-07-22 (Proposed) → 2026-07-22 (Accepted)

#### Context

`ADR-016` established an email-verification gate as a locked security primitive for `User` registration (`ARCHITECTURE_LOCK.md`: *"Email verification gate before login"*; `PRODUCT_REQUIREMENTS.md` FR-01.1: *"Email/password registration with email verification gate"*). Prior to this ADR, customer (`intent=customer`) registration was never implemented in code — only Organization Owner self-registration (`intent=owner`) exists (`RegisterOrganizationOwnerUseCase`, public `POST /auth/register`), which uses email/password and a (currently delivery-less) email-verification token.

Approved product direction (2026-07-22) establishes **two structurally distinct identity/provisioning models that must not be merged**:

* **Customers** (`User`, phone-first): `username + phone` → WhatsApp OTP via Fonnte → verify → set password → account created/active. No email is collected or required. No email verification exists for this actor.
* **Restaurant Owners**: **not** publicly self-registered. Provisioned administratively by a Platform/System Admin, using email + password. **No email-verification step applies** — an administratively-created account is immediately eligible to authenticate under the account-status rules already governing administratively-provisioned accounts (ADR-016 §"User Lifecycle").

This corrects the original ADR-022 proposal's assumption that Owner registration would continue unchanged as public self-registration with email verification — that assumption is rejected. See Decision #1 and "Owner Provisioning Model Change" below.

#### Decision

**1. Email verification is removed as a requirement for both affected actors, for different reasons, and is retained only where a genuine remaining consumer exists (see "Email-Verification Subsystem Impact").**
- Customers never had it and never will (phone/WhatsApp replaces it entirely).
- Restaurant Owners no longer need it because they are no longer publicly self-registering: an administratively-provisioned account is created directly in an authenticatable state by a trusted internal actor (the Platform Admin), the same trust boundary that already lets `$systemContext`/`PlatformAdmin` bypass tenant scoping (`AUTHORIZATION_ARCHITECTURE.md` §"Principals"). Verifying an email address the account holder didn't even submit themselves (the admin did) provides no security benefit.

**2. Customer registration lifecycle (frozen):**
```
START (username + phone, E.164)
  → send 6-digit OTP via WhatsApp (Fonnte)
VERIFY (OTP)
  → COMPLETE only unlocked for this exact pending registration
COMPLETE (set password)
  → real User row created, status Active, phone as login identity
RESEND (separate Domain Action, invalidates + reissues, subject to same rate limits)
```
No `User` row exists in any form until `COMPLETE` succeeds (ADR Note A, unchanged from the Proposed draft).

**3. Restaurant Owner provisioning lifecycle (frozen):**
```
Platform Admin (authenticated, PlatformAdminGuard-protected) provisions Owner
  → User row created directly: email + password (Argon2id), status Active
  → no verification token issued, no verification step exists
  → Owner may authenticate (email + password) immediately
```
This is **not** a new registration flow to design from scratch — it reuses `RegisterOrganizationOwnerUseCase`'s existing transactional shape (User + Organization + OrganizationMember(Owner) + UserConsent in one transaction) minus the email-verification-token step, invoked by an authenticated Platform Admin action instead of an anonymous public request. See "System/Platform Admin Provisioning" below for what already exists vs. what remains an implementation dependency.

**4. Phone is the canonical identity attribute for customer accounts** (canonical E.164, produced by the normalization rule in "Country Code Selection / Phone Normalization" below), used identically for uniqueness, OTP delivery, verification, promotion, and login lookup. Email remains the canonical identity attribute for Owner accounts, unchanged.

**5. Fonnte isolated behind `VerificationMessagingPort`** (application port) → `FonnteVerificationMessagingAdapter` (infrastructure). `FONNTE_API_TOKEN` via validated environment configuration only. Delivery is **synchronous** (not BullMQ) — the customer is actively waiting for the code; a bounded/fast provider timeout is required, and provider failures are translated to a closed result type before reaching application code (see "Fonnte Integration Boundary").

**6. OTP security/lifecycle (all frozen, all approved explicitly — none invented):**

| Parameter | Value |
|---|---|
| Format | Exactly 6 numeric digits, zero-padding allowed (e.g. `004821`) |
| Generation | Cryptographically secure RNG (`crypto.randomInt`), never `Sha256OpaqueTokenService`'s 256-bit generator (wrong shape/entropy profile) |
| Storage | Hash only, never plaintext — same hash-at-rest convention as `EmailVerificationToken.tokenHash` |
| Expiration | 5 minutes |
| Max incorrect attempts | 5 per issued OTP; on the 5th failure the OTP becomes unusable and a new one must be requested — **no automatic silent reissue** |
| Resend cooldown | 60 seconds; a request before cooldown expiry is rejected via the project's existing rate-limit error convention (`429`, `RATE_LIMIT_EXCEEDED`) |
| Send/resend rate limit | Max 5 OTP sends per phone number per rolling hour (initial send + resends combined) |
| Verification rate limit | Max 10 verification requests per 15 minutes per phone/IP scope — independent of, and in addition to, the 5-incorrect-attempts-per-code cap |
| Resend model | Immediately invalidates the previous OTP, generates a completely new one, stores only the new hash, resets the per-code attempt counter to zero; does not bypass send/resend rate limits |
| Success invalidation | Successful verification invalidates every other outstanding code/challenge for that phone number; verification is single-use; a consumed challenge cannot be replayed |

Never logged/audited/returned by any API response/Swagger example in either plaintext or the codebase's existing OTP-redaction convention (`NON_FUNCTIONAL_REQUIREMENTS.md` already lists "OTP codes" in its never-log list, pre-existing this ADR).

**7. Pending-registration model (frozen shape, per-field minimalism required):** a dedicated entity separate from `User` — following the project's own precedent that `Employee.userId` is nullable specifically so an Employee can be invited/persisted before any `User` identity exists, later linked via `activateAndLink()`. Required fields, and only these: `username`, canonical E.164 `phone`, OTP `codeHash`, `codeExpiresAt`, `incorrectAttemptCount`, verification state + `verifiedAt`, consumed/completed state, `createdAt`/`updatedAt`. Cleanup of abandoned (expired, never-completed) rows is required, but no authoritative retention duration exists anywhere in this repository (`EmailVerificationToken`/`PasswordResetToken` rows are never purged today — confirmed, no cleanup job exists in the codebase) — this single duration is the one item in this ADR left as a narrow open decision (see "Remaining Open Items").

**8. API lifecycle — four Domain Actions, frozen in shape and count:** Start, Resend, Verify, Complete. `COMPLETE` is only reachable after `VERIFY` succeeded for the *same* pending-registration record (never a different phone/session); a pending registration cannot be promoted twice; verifying phone A never authorizes completing phone B. ~~Concrete route names, derived (not invented) from this repository's existing flat, kebab-case, verb-object `/auth/*` convention... `POST /auth/register-customer`, `POST /auth/resend-phone-verification`, `POST /auth/verify-phone`, `POST /auth/complete-customer-registration`... a costless, non-architectural rename~~ — **superseded by Decision #17 below (2026-07-22): the exact route names are now explicitly frozen by product decision under a nested `/auth/customer/...` namespace, not the flat derivation originally proposed here.** The four-operation shape and per-operation invariants stated above remain authoritative and unchanged; only the literal route strings changed.

**9. Phone-uniqueness enforcement mechanism (resolved — no actor discriminator introduced):** `User.phone` changes from a non-unique index to a **nullable unique constraint** (`UNIQUE` allows multiple `NULL`s in PostgreSQL). This is the smallest safe mechanism: it makes "no two customers share a phone" absolute while leaving Owner rows (`phone = NULL`) completely unconstrained — exactly the same shape of solution as `EmailVerificationToken`/`PasswordResetToken` already use nullable-optional relationships without a discriminator column. `User.username` follows the identical pattern (nullable, unique, absent for Owner rows). No actor-type/discriminator column is introduced on `User` — the existing model, extended with two nullable-unique columns, is sufficient. Case-insensitive comparison for `username` (citext column type vs. a normalized shadow column) is a schema-design detail deferred to the implementation phase, not a product/architecture decision blocking this ADR.

**10. Customer login: phone + password. Owner login: email + password. No single ambiguous client-controlled "identifier" field** — two actor-appropriate authentication paths (either two endpoints, or one endpoint with two mutually-exclusive, explicitly-typed request shapes — an implementation detail, not decided here), consistent with the instruction to prefer explicit semantics over an ambiguous identifier. All ADR-016 mechanics unrelated to the identifier itself are **fully preserved, unchanged, for both paths**: Argon2id hashing, access JWT, opaque refresh tokens + rotation, `DeviceSession`, `TokenFamily`, `sessionVersion`, `permissionsVersion` (where applicable), reuse detection, logout/revocation behavior. `UserRepository` gains a `findByPhone` method alongside its existing `findByEmail` — an additive port change, not a redesign.

**11. Employee invite-linking is NOT converted to phone.** It remains email-keyed exactly as implemented today (`LoginUseCase`'s `findUnlinkedInvitedByEmail`), because Restaurant Owners and staff are administratively/email-based identities, not customer-phone identities, and no approved requirement says otherwise. A phone-only customer `User` who is later invited as staff cannot be matched by this mechanism today — this is a real, acknowledged gap, but per explicit instruction it is **not resolved inside this ADR**. Any future cross-identity linking rule (e.g., matching by a staff-supplied phone number, or requiring the customer to add an email at invite time) is deferred to a separate, future architecture decision, not invented here.

**12. No customer email-registration fallback exists or is planned.** Customer registration is phone-first only, permanently, per this ADR — there was never a prior email-based customer flow to fall back to (it was never implemented), so this is a clarification, not a removal.

**13. Country Code Selection / Phone Normalization (approved, 2026-07-22 — supersedes both the original Proposed-draft wording and a later, incorrect interpretation of it):**

This decision replaces two prior formulations, neither of which is authoritative any longer: (a) the original ADR-022 text *"the client must provide an explicit international phone number including country code; do not infer a default country"*, and (b) a subsequent, incorrect reading of that text as meaning the backend should assume `+963` whenever a country code is absent. **The authoritative rule is:**

> The TAVLA mobile application's Country Code Picker defaults to **Syria (+963)**, while allowing the customer to select any other supported country. The backend validates and normalizes the *selected country calling code* plus the *entered national/local number* into canonical E.164 before the value is used for persistence, uniqueness checks, OTP delivery, verification, or authentication.

Precise distinction (must not be conflated):
- **Default country** (`+963`, Syria) is a **mobile UX default** — the picker's preselected value, changeable by the customer. It is not a backend assumption, a registration restriction, or a fallback applied when a country code is "missing."
- **Supported country** is any country the app's phone-validation and Fonnte/WhatsApp delivery capabilities cover — not limited to Syria. A customer who selects `+971` (UAE) or any other supported country must have that selection respected exactly; the backend must never substitute `+963` for an explicitly selected non-Syrian code.

Worked examples (illustrative, not exhaustive): selecting Syria (+963) and entering local number `0912345678` normalizes to `+963912345678` (leading trunk `0` dropped, `963` prepended); selecting UAE (+971) and entering a local number normalizes to `+971`+the national significant number, never `+963...`.

Responsibility split (frozen):
- **Mobile**: renders the Country Code Picker, preselects Syria (+963), lets the customer pick another supported country, collects the national/local number separately from the country selection, and sends the backend enough information to reconstruct the selection (i.e., the app must not silently collapse the picker's selection and the national number into an ambiguous single string the backend has to guess apart).
- **Backend**: is the **authoritative normalization boundary** — never trusts client-side formatting alone, independently validates the selected calling code against the entered national number, produces canonical E.164, and rejects invalid combinations. The backend never stores only the local/national number as the identity — only canonical E.164 is ever persisted, checked for uniqueness, or handed to the Fonnte adapter (§"Fonnte Integration Boundary" still strips the leading `+` only at that adapter boundary, unchanged).
- Equivalent representations of the same number (e.g., with/without leading trunk zero, differing separators) must resolve to one canonical identity; uniqueness checks are always performed against the canonical form, never raw input.

This item was previously implicitly covered by Decision #4's shorthand ("explicit country code, no default-country inference") and by `DOMAIN_MODEL.md`'s `PhoneNumber` VO note — both are now superseded by this fuller, unambiguous statement and have been updated to reference it rather than repeat the old shorthand.

**14. Phone parsing/normalization library — `libphonenumber-js` (approved, 2026-07-22, not yet installed).** Resolves the Phase 2.23 Implementation Planning Report's open item: this repository has no phone-parsing dependency today (confirmed by reading `apps/backend/package.json` directly). Hand-rolled international phone parsing is explicitly rejected. `libphonenumber-js` is the approved library for validating the selected calling-code/national-number combination (Decision #13) and producing canonical E.164. Adding the dependency (package.json + lockfile) is implementation work, out of scope for this documentation-only decision.

**15. Restaurant Owner provisioning — password delivery is out of backend scope (approved, 2026-07-22).** The Platform Admin sets the Owner's password directly at creation time; the backend's only responsibility is to hash (Argon2id) and persist it, exactly as every other password-setting path already does. **There is no password-delivery mechanism in Phase 2.23** — no email, no WhatsApp/Fonnte message, no temporary-password service, no automatic reset-link generation as part of provisioning, and no new email provider. Credential communication from Platform Admin to Owner is an out-of-band operational responsibility, not a backend concern. Mandatory first-login password change is **not** introduced by this decision — it applies only if some other already-frozen architecture independently requires it (none does today). Lifecycle: `Platform Admin creates Owner → Owner account is immediately usable → Owner logs in with email + password` (§15.2 unchanged otherwise).

**16. Customer password recovery — phone/WhatsApp OTP, frozen (approved, 2026-07-22).** Resolves the Planning Report's flagged architectural gap. Customers have no email, so recovery cannot reuse the Owner's email-based `forgot-password`/`reset-password` flow (Decision: **do not reuse it for Customers**). Frozen Customer recovery lifecycle:
```
START (canonical E.164 phone)
  → send 6-digit OTP via WhatsApp (Fonnte)
VERIFY (OTP)
  → establishes a verified, not-yet-consumed recovery state; does NOT itself change the password
COMPLETE (new password)
  → password changes only here, after successful OTP verification; consumes the recovery state atomically
RESEND (separate Domain Action, same cooldown/rate-limit rules as registration)
```
Reuses, unmodified, every OTP security rule already frozen for registration (Decision #6): 6 numeric digits, crypto-secure generation, hash-only storage, 5-minute expiry, max 5 incorrect attempts, 60s resend cooldown, 5 sends/phone/hour, 10 verify requests/15min, resend invalidates+reissues, single-use/replay-safe. The recovery challenge is a **separate persisted concept from the registration pending-record** (an existing Customer's phone is being re-verified, not a new username/phone pair being claimed) — see "Database Impact" note below. Enumeration resistance applies identically to this flow: whether an arbitrary phone belongs to an account must not be distinguishable via response behavior. **Restaurant Owner and Employee/staff password recovery are unchanged** — Owner keeps the existing email-based `forgot-password`/`reset-password` flow exactly as implemented today; no cross-identity recovery is introduced.

**17. Final frozen API surface (approved, 2026-07-22 — supersedes Decision #8's provisional route names, which were explicitly non-final).** Verified against the real repository: no existing controller anywhere uses a `platform-admin`-prefixed or `/auth/customer/...`-nested route today (the `platform-admin` module is an empty scaffold with no controller at all), so freezing these exact names introduces no conflict with an established convention.

*Customer registration:*
- `POST /auth/customer/register/start` — body conceptually `{ username, countryCode, phoneNumber }`; normalizes to canonical E.164; validates username/phone availability; applies Decision #18's concurrency rule; generates and sends OTP.
- `POST /auth/customer/register/resend`
- `POST /auth/customer/register/verify`
- `POST /auth/customer/register/complete` — requires a verified, unconsumed pending registration; input includes the chosen password; creates the real Customer `User` and consumes the pending registration atomically.

*Customer login:*
- `POST /auth/customer/login` — body `{ countryCode, phoneNumber, password }`; backend normalizes to canonical E.164 before lookup. A separate contract from Owner/staff login — **not** a discriminated union on the existing DTO.

*Owner/staff login (unchanged):*
- `POST /auth/login` — email + password, as today.

*Owner provisioning:*
- `POST /platform-admin/restaurant-owners` — authenticated, Platform-Admin-only; creates the Owner using email + password + existing required organization-owner data; no verification step follows.
- The existing public `POST /auth/register` **must not remain** a public Owner self-registration endpoint (unchanged conclusion from "Owner Provisioning Model Change" below, now with a concrete replacement route named).

*Customer password recovery:*
- `POST /auth/customer/password-reset/start`
- `POST /auth/customer/password-reset/resend`
- `POST /auth/customer/password-reset/verify`
- `POST /auth/customer/password-reset/complete`

*Unchanged, identifier-agnostic (no route or contract change):* `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET/DELETE /auth/sessions[...]`, `POST /auth/change-password`.

**18. Repeated START / one-active-pending-registration-per-phone (approved, 2026-07-22).** At most one active pending Customer registration may exist per canonical phone at any time. A second valid `START` for the same phone is a **restart/reissue** of the existing pending registration, not a second parallel one: the previous active OTP is invalidated, a new OTP is generated, the incorrect-attempt counter resets, the same resend/send rate limits apply (this does not bypass them), no `User` is created, and username/phone uniqueness checks are not bypassed. Concurrency (two simultaneous `START`s for the same phone) must be protected at the database/application transaction boundary so exactly one active registration identity can ever exist per phone — never two. This is the same one-active-record-per-key shape already proven by `EmailVerificationRepository.invalidateActiveByUserId` + `save`, applied to phone instead of `userId`.

#### Owner Provisioning Model Change (supersedes the original ADR-022 Proposed-draft assumption)

The Proposed draft of this ADR assumed Organization Owner registration would continue unchanged (public self-registration, email + password, email-verification token retained). **That assumption is rejected by this Accepted decision.** The authoritative Owner model is: administratively provisioned only, by a Platform/System Admin, email + password, no verification step, immediately authenticatable. See "System/Platform Admin Provisioning" for what currently exists in code vs. what remains to be built — the absence of a working admin-provisioning endpoint today is an **implementation dependency**, not a reopening of this product decision.

One direct consequence, recorded here rather than silently left implicit: the **currently implemented** `RegisterOrganizationOwnerUseCase` / public `POST /auth/register` endpoint is public self-registration for Owners — which the newly-frozen model says must not exist going forward. This is not touched in this documentation-only task (no code changes were made), but it is now a **redesign/deprecation candidate** for the same future implementation phase that builds admin-provisioning, and must not be mistaken for already-compliant just because it currently exists and passes tests.

#### ADR Note A — Account-Creation Semantics (unchanged from Proposed draft)

No `User` row (and therefore no login capability, session, or JWT) may exist for a customer until both phone verification and password-setting are complete. The pending-registration entity's existence as a separate concept from `User` is decided; its exact field list is frozen in Decision #7.

#### Alternatives Considered

* **Generalizing `EmailVerificationToken` into a channel-agnostic verification-token table** — rejected (unchanged reasoning from the Proposed draft): conflates two materially different security profiles.
* **Creating an `Active`/`Pending` `User` row immediately at Start** — rejected (unchanged reasoning): contradicts the explicit account-creation-order requirement and would force a nullable `passwordHash`.
* **Keeping Owner self-registration as-is, only removing its email-verification step** — rejected: the approved product decision is explicit that Owners are administratively provisioned, not self-registered at all; removing only the verification step while keeping public self-registration would not match the approved model.
* **A single polymorphic login "identifier" field accepting either email or phone** — rejected per explicit instruction: prefer actor-appropriate explicit semantics over a client-controlled ambiguous field.
* **Converting Employee invite-linking to phone-keyed matching** — rejected per explicit instruction: staff/Owner identity is not a customer-phone identity; no approved requirement justifies this change, and doing so would conflate two distinct identity models this ADR is expressly designed to keep separate.

#### Consequences

* Positive: Customer registration no longer depends on email deliverability; Owner provisioning gets a proper administrative trust boundary instead of open self-registration.
* Positive: Reuses established Clean Architecture conventions throughout (ports/adapters, `UnitOfWorkPort`, `SystemConfigurationPort`, hash-at-rest tokens, existing rate-limit infrastructure) — no new architectural pattern introduced.
* Negative: Introduces Fonnte as a new external SaaS dependency and a new failure domain that must not leak into the public API.
* Negative: `PlatformAdminGuard` and an Owner-provisioning use case do not yet exist in code (see "System/Platform Admin Provisioning") — a real implementation dependency for the eventual implementation phase, not a blocker to freezing this architecture.
* Negative: The existing public Owner self-registration endpoint is now a deprecation/redesign candidate, meaning Phase 2.23's implementation scope is larger than "add customer registration" — it also includes retiring/replacing the existing Owner self-registration path to match the frozen model.
* Neutral/Deferred: Employee invite-linking's email-only matching leaves a known, accepted gap for phone-only customers who later become staff — explicitly deferred to a future ADR, not resolved here.

#### Fonnte Integration Boundary

**SUPERSEDED by ADR-024 (2026-07-23) — retained below for historical record only, not authoritative.** Fonnte is no longer the active Customer OTP delivery provider; LightOTP is. See **ADR-024** for the current, live-verified integration boundary and contract. Per `CHANGE_POLICY.md`'s "supersede, do not edit accepted ADRs in place" rule, the historical text below is preserved unmodified rather than rewritten.

`Application → VerificationMessagingPort (interface) → FonnteVerificationMessagingAdapter (infrastructure) → Fonnte HTTP API`. Domain/application code never depends on Fonnte HTTP payloads, response objects, status codes, error strings, or SDK-specific types.

**Verified Fonnte HTTP Contract** (fetched from Fonnte's official documentation at `docs.fonnte.com` during this architecture-finalization task — not called, no message sent, informational only):

| Aspect | Verified value |
|---|---|
| Endpoint | `POST https://api.fonnte.com/send` |
| Auth header | `Authorization: <token>` — plain token value, **no** `Bearer` prefix |
| Required body fields | `target` (string; phone number(s), comma-separated for multiple), ~~`message`~~ **and `countryCode`** (string, ≤60,000 chars) — see live-verification correction below |
| Target format | Fonnte expects the number **without** a leading `+` (E.164's `+` must be stripped by the adapter before sending — a boundary-only conversion, never a change to the canonical stored E.164 value); ~~Fonnte auto-prepends country code `62` only to numbers with a leading `0`, which correctly-formed E.164 numbers never have~~ **incorrect, see live-verification correction below** |
| Success response | `{"status": true, "detail": "...", "id": [...], "process": "pending", "requestid": ..., "target": [...]}` |
| Failure response | `{"status": false, "reason": "...", "requestid": ...}` — documented reasons include invalid token, mismatched device, invalid target format, insufficient quota |
| Timeout | Not mandated by Fonnte's documentation — the adapter must set its own explicit bounded timeout (a synchronous-call implementation detail, not a value this ADR fixes) |

This satisfies the requirement to verify the contract before implementation begins; the adapter itself is not implemented in this task.

**Live-verification correction (Phase 2.23 closure follow-up):** the documentation-only table above, based solely on Fonnte's published docs, turned out to be wrong on one material point once actually exercised against the live API. Fonnte does **not** limit its Indonesia (`+62`) auto-prepend behavior to numbers with a leading `0` — it applies to any `target` it cannot otherwise disambiguate, including an already-correct, `+`-stripped E.164 number with no leading `0` at all (a real Syrian number `963936862035` was silently turned into `62963936862035` by Fonnte, with the API still reporting `status: true`/"queued" — the request "succeeds" but no message is ever delivered). The fix is to always send an explicit `countryCode` field alongside `target` (derived from the same canonical `PhoneNumber`, via a new `PhoneNumber.callingCode()` method — never hardcoded or independently re-parsed), which resolved the mangling in direct live testing. `FonnteVerificationMessagingAdapter` and `AUTHENTICATION_ARCHITECTURE.md` §15.8 are both updated accordingly. This is a mechanical bug fix to an already-frozen integration boundary, not a new architectural decision.

#### System/Platform Admin Provisioning — Findings

`PlatformAdmin` already exists as a real, persisted concept: `schema.prisma`'s `PlatformAdmin` model (`id`, `userId` unique, `createdAt`, `revokedAt`) and a `PlatformAdmin` `actorType` already recognized in JWT claims (`access-token-claims.ts`, `authenticated-actor.dto.ts`) and documented in `AUTHORIZATION_ARCHITECTURE.md` (*"Platform | `PlatformAdmin` | Above all tenants"*, `$systemContext` escape hatch). **This is the correct, existing actor for Owner provisioning — no new administrator type is introduced.**

However, **`PlatformAdminGuard` is explicitly documented as unbuilt** (`TASKS.md` Phase 2.15: *"`PlatformAdminGuard`... remain explicitly out of scope and unbuilt"*), and no Owner-provisioning use case/endpoint exists in code today. This is a genuine implementation dependency for the phase that builds this feature — it does **not** reopen or block this product decision, per explicit instruction; it is recorded here so the future implementation phase knows `PlatformAdminGuard` must be built (or confirmed already built by then) before an Owner-provisioning endpoint can be safely exposed.

#### Email-Verification Subsystem Impact (deprecation analysis)

Under the now-fully-approved model, the email-verification subsystem (`EmailVerificationToken`, `EmailVerificationRepository`, `EmailVerificationPolicy`, `VerifyEmailUseCase`, `POST /auth/verify-email`, the `emailVerified` column) **has no remaining legitimate consumer**:
- Customers: phone-first, never used it, never will.
- Restaurant Owners: per this ADR, administratively-provisioned accounts require no verification step at all.
- `Employee`/`OrganizationMember`: never used this mechanism for their own linking (invite-linking is a separate, unrelated code path; `OrganizationMember.status = Invited` has nothing to do with `EmailVerificationToken`).

**Recorded as a deprecation/removal candidate for the future implementation phase.** Per explicit instruction, **nothing is deleted in this task** — `EmailVerificationToken`, `VerifyEmailUseCase`, `EmailVerificationRepository`, the `email`/`emailVerified` columns, and `POST /auth/verify-email` all remain exactly as they are in code today.

#### Remaining Open Items (narrow, does not block Acceptance)

The four items the Phase 2.23 Implementation Planning Report flagged as requiring explicit approval (phone-parsing library, Owner password-delivery, Customer password recovery, final API route names) plus the repeated-`START` concurrency question are **now resolved** by Decisions #14–18 above. The three items below are unrelated, pre-existing narrow items, unaffected by this update:

1. **Pending-registration retention/cleanup duration** — no authoritative value or existing cleanup mechanism exists anywhere in this repository (confirmed: neither `EmailVerificationToken` nor `PasswordResetToken` rows are ever purged today). This single duration must be set by product/ops before the cleanup job is implemented; not invented here.
2. **`username` case-insensitive-uniqueness enforcement mechanism** (citext column vs. a normalized lowercase shadow column) — a schema-design implementation detail for the future migration-planning step, not a product decision.
3. **Cross-identity linking rule for a customer who later becomes staff** — explicitly deferred to a separate future ADR per Decision #11; not part of this ADR's scope.

None of these block implementation readiness in the way the original 15-item Proposed-draft list did — all three are either non-architectural implementation details or explicitly out-of-scope future work.

#### Impact

Affects (synchronized as part of this Acceptance — see each document's own change): `ARCHITECTURE_LOCK.md` (ADR-016 annotation + ADR-022 added to the locked table), `AUTHENTICATION_ARCHITECTURE.md`, `PRODUCT_REQUIREMENTS.md` (FR-01.1), `DATABASE_SCHEMA.md`, `DOMAIN_MODEL.md`, `EVENTS.md`, `ENVIRONMENT_SETUP.md`, `TESTING_STRATEGY.md`, `TASKS.md` (Phase 2.23 entry under "Phase 2 — Authentication & Authorization", now closed), `PROJECT_ROADMAP.md`, `README.md`. Does not affect Phase 7.2 (Approval Workflow) or any Reservation-domain architecture. `modules/authentication/` and the new `modules/platform-admin/` code are both implemented, tested, and live-verified as of Phase 2.23's closure (2026-07-22) — see `TASKS.md`'s closure report for full evidence.

**Platform Admin Authentication addendum (Phase 2.23 closure, 2026-07-22):** confirms and implements §5.2's pre-existing "separate issuer/audience" decision for `actorType: PlatformAdmin` — own signing secret (`PLATFORM_ADMIN_JWT_SECRET`), own issuer (`tavla-platform-admin`), own audience (`tavla-platform-admin-clients`), verified by a self-contained `PlatformAdminGuard` that never delegates to the ordinary `JwtAuthGuard`/`AuthenticatedActor` pipeline. This is a mechanical implementation of an already-frozen decision, not a new architectural decision, so it is recorded here as an addendum rather than a new ADR, per `CHANGE_POLICY.md`'s convention for implementing (not changing) a previously-approved decision. Full verification: `AUTHENTICATION_ARCHITECTURE.md` §15.2's addendum and `test/authentication/platform-admin.e2e-spec.ts`'s 11-scenario security-isolation matrix.

---

## ADR-023

### Title

Multi-Table Reservation Reschedule Concurrency (extends ADR-013)

### Status

Accepted

### Date

2026-07-23

### Context

Phase 7.3 (Reservation Lifecycle) approved that Rescheduling a Reservation may change its assigned Table (in addition to date, time, and party size), restricted to another Table within the same Branch. ADR-013 (Reservation Concurrency Strategy) defines a single-table advisory-lock + exclusion-constraint mechanism, scoped to exactly one `(branchId, tableId, reservationDate, timeSlotBucket)` key per protected operation (Create, and per Phase 7.2, Approve). A table-changing Reschedule of an `Approved` reservation is the first operation that must coordinate two physical Tables' occupancy atomically within one transaction — releasing the old Table's `Reserved` status, reserving the new Table's, and validating the new window is conflict-free — a scenario ADR-013 does not define a locking protocol for. Per `CHANGE_POLICY.md` criterion #7 ("changes concurrency or consistency guarantees for reservations"), this requires a new ADR; per `ARCHITECTURE_LOCK.md`'s own Unlock Procedure ("propose a new ADR... do not edit accepted ADRs in place — supersede with a new ADR"), ADR-013's own historical text is not modified by this decision.

### Decision

Extend ADR-013's advisory-lock mechanism, without altering its existing single-table behavior for Create/Approve/same-table Reschedule, to a deterministic two-key acquisition protocol for table-changing Reschedule only:

1. **Derive both lock keys using the existing, unmodified `ReservationAvailabilityService.deriveLockKey`/`deriveTimeSlotBucket` mechanism** — one for the reservation's current `(branchId, oldTableId, reservationDate, oldTimeSlotBucket)`, one for the target `(branchId, newTableId, newReservationDate, newTimeSlotBucket)`. No new key-derivation mechanism is introduced.
2. **Acquire both locks inside the same database transaction, in deterministic sorted order** (lexicographic comparison of the two derived lock-key strings — the lexicographically smaller string's lock is acquired first) — never in caller-/request-dependent order — so that two concurrent reschedules moving reservations in opposite directions between the same two tables cannot deadlock.
3. **Re-check for a confirmed overlap at the new table/window** (identical to the existing Approve/Create pre-check, excluding the reservation's own row by id), then release the old Table, reserve the new Table, and update the Reservation row's `tableId`/`reservationStartTime`/`reservationEndTime`/`guests` — all inside the one transaction. If any step fails, the entire transaction rolls back: the Reservation, old Table, and new Table all remain exactly as they were before the attempt (no partial movement).
4. **The existing database exclusion constraint (`reservations_no_overlapping_confirmed_excl`) remains the authoritative safety net** for the target row's new window, exactly as it already is for Create/Approve — an in-place `UPDATE` of the Reservation's own `tableId`/`reservationStartTime`/`reservationEndTime` is evaluated by the same constraint as any other write to that row; the constraint does not distinguish an `UPDATE` from an `INSERT`, so no special-casing is required.
5. **A same-table Reschedule (no table change) requires only the single existing lock key** for the new time window, matching Create/Approve exactly — no second key, no new protocol. **A Reschedule of a `Pending` reservation** (regardless of whether the table changes) **never calls `Table.reserve()`/`Table.release()` at all**, matching Phase 7.2's established "a `Pending` reservation never reserves a table" principle — only the advisory lock(s) and the conflict pre-check apply, since there is no Table state to move; `Reservation.tableId` is simply updated in place.
6. **Approved-reschedule auto-rejection:** per the same-slot-wins principle already frozen for Approval (Phase 7.2), when an `Approved` reservation is successfully rescheduled into a new window/table, any other `Pending` reservation now overlapping that target Table is automatically rejected inside the same transaction, using the identical mechanism (and identical "no Table operation" rule) Phase 7.2 already established for Approval — not a new mechanism. This does **not** apply when the reservation being rescheduled is itself still `Pending` — a `Pending` reservation does not "win" a slot merely by being rescheduled into it.

### Alternatives Considered

* **A merge-group-style "reservable unit" lock spanning both tables as one lock namespace.** Rejected: over-engineered for exactly two known, individually-identified tables, and risks conflating this with the still-unresolved Merge/Split architecture (dependency unlocked, architecture review pending as its own separate track) — this ADR must not, and does not, touch that.
* **Locking only the new table, treating the old table's release as lock-free.** Rejected: leaves a narrow window where a concurrent operation could race the old table's release against another reservation being created/approved for that same freed slot; the two-key protocol closes this at negligible cost, since reschedules are comparatively rare relative to Create/Approve traffic.
* **A single global reservation-write lock.** Rejected for the same throughput reasons ADR-013 itself already rejected full `SERIALIZABLE` isolation.

### Consequences

#### Positive

* Table-changing Reschedule is now provably deadlock-safe and atomic, closing the one concurrency gap Phase 7.3 introduces.
* Reuses 100% of ADR-013's existing lock-key derivation, advisory-lock primitive, and exclusion-constraint safety net — no new infrastructure, no new concurrency subsystem.
* Same-table Reschedule and Reschedule-of-Pending remain exactly as simple as Create/Approve's own existing single-key mechanism — this ADR only adds complexity for the one genuinely new scenario.

#### Negative

* A table-changing Reschedule now acquires two advisory locks instead of one, marginally increasing lock contention for that specific operation only; Create, Approve, and same-table Reschedule are entirely unaffected.

### Impact

Affects: `ReservationAvailabilityService` (reused unmodified — no change), the Reschedule use case and repository method (Phase 7.3, implemented and live-verified 2026-07-23), `DECISIONS.md` (this ADR), `ARCHITECTURE_LOCK.md` (added to the locked ADR table), `TASKS.md` (Phase 7.3 — Reservation Lifecycle pre-implementation decision note and implementation report). Does not alter ADR-013's own historical Decision/Context/Alternatives/Consequences text — extends it for exactly one new operation (table-changing Reschedule) via this superseding ADR, per `CHANGE_POLICY.md`. Does not affect Merge/Split Tables (still a separate, unlocked-but-architecturally-unreviewed track) or any Phase 7.2 (Approval Workflow) semantics.

---

## ADR-024

### Title

OTP Delivery Provider Migration: Fonnte → LightOTP

### Status

Accepted

### Date

2026-07-23

### Context

ADR-022 (§"Fonnte Integration Boundary") introduced Fonnte as the Customer phone/WhatsApp OTP delivery provider, isolated behind `VerificationMessagingPort`. The business rule ADR-022 froze — "Customer verification occurs through phone/WhatsApp OTP" — is unaffected by this decision; only the **infrastructure choice of which provider delivers that OTP** changes. The Owner explicitly approved a provider change to LightOTP (`https://lightotp.com`) and supplied a live API key for local configuration/testing via environment variables only, never committed. Per `CHANGE_POLICY.md` criterion (a provider swap behind an already-frozen port is an infrastructure-adapter change, not a redesign of the Customer authentication architecture), and following the same "supersede, do not edit accepted ADRs in place" convention ADR-023 already established for ADR-013, this ADR supersedes only ADR-022's "Fonnte Integration Boundary" subsection — nothing else in ADR-022 (Customer registration/login/recovery state machines, phone normalization architecture, Owner provisioning, OTP security rules) is reopened, redesigned, or affected.

**Verified LightOTP Contract** (fetched from LightOTP's official documentation at `lightotp.com/docs` prior to implementation — not called, no message sent, informational only):

| Aspect | Verified value |
|---|---|
| Base URL / Endpoint | `POST https://api.lightotp.com/SendMessage` |
| Auth header | `X-Api-Key: <key>` |
| Required body fields | `otpCode` (string, 1–8 chars, letters/digits only), `toPhoneE164` (string, full E.164 **with** leading `+`) |
| Optional body fields | `languageCode` (BCP-47, selects the WhatsApp message language — falls back to the account's default language if omitted/unmatched), `idempotencyKey` (UUID, safe-retry semantics) |
| Target format | **Full E.164 with leading `+`** — the opposite of Fonnte's stripped-`+` `target` field; no adapter-side stripping is performed |
| Message/template | **No free-text message field exists at all.** The WhatsApp message content is entirely provider/account-managed, selectable only by `languageCode`. There is no `template_id` or equivalent field to configure — see "Message/Template Contract" below |
| Success response | `{"id": "<uuid>", "messageStatus": "Pending\|Sent\|Delivered\|Read\|Failed\|Deleted"}` |
| Failure response | `{"errorMessage": "<code>"}`, e.g. `InvalidphoneNumber`, `InsufficientBalance`, `ApiKeyNotFound`, `TemplateNotFound` |
| HTTP status codes | `200` success; `400` validation/cooldown/insufficient-balance; `404` unknown API key; `429` rate limit; `5xx` provider error |
| Rate limit / cooldown | Per-IP request rate limiting (`429`, no specific published number); per-phone duplicate-send cooldown starting at 30s and doubling per additional send within a rolling 6-hour window, capped at 6 hours |
| Timeout | Not documented by LightOTP — the adapter sets its own explicit bounded timeout (`LIGHTOTP_REQUEST_TIMEOUT_MS`), identical in principle to the retired Fonnte adapter's own timeout handling |

### Decision

1. **`FonnteVerificationMessagingAdapter` is replaced by `LightOtpVerificationMessagingAdapter`**, implementing the same, unmodified `VerificationMessagingPort` interface (`sendVerificationCode(phone: PhoneNumber, code: string): Promise<VerificationMessagingResult>`) — no application/domain-layer code changes, per ADR-022's own port/adapter boundary design working exactly as intended for a provider swap.
2. **Canonical E.164 (`PhoneNumber.value`, with its leading `+`) is sent directly as `toPhoneE164`** — no boundary conversion is needed, unlike Fonnte's stripped-`+` requirement. `PhoneNumber.toFonnteTarget()` and `PhoneNumber.callingCode()` (both Fonnte-specific formatting/disambiguation helpers, never a canonical-identity concern) are removed from the shared `PhoneNumber` value object as dead code — LightOTP's `toPhoneE164` field requires neither.
3. **Message/Template Contract (mechanical consequence, not a product decision):** the previously approved message text ("your verification code to tavola is: {CODE}\npowered by vegacore") **can no longer be sent as application-controlled copy** — LightOTP's `/SendMessage` endpoint accepts no message/template field at all; the WhatsApp message body is entirely provider/account-managed, varied only by the optional `languageCode`. Per this task's own explicit instruction ("DO NOT silently invent a template... report the requirement"), no template is invented or guessed at here — this is disclosed as a real, provider-driven limitation. `languageCode` itself is omitted by the adapter (no per-call customer-language input exists on the current `VerificationMessagingPort` signature; extending the port to carry one is out of scope for a provider migration and is not done here).
4. **Configuration:** `LIGHTOTP_API_KEY` (secret, environment-only, allow-empty-fails-closed-at-send-time convention identical to `FONNTE_API_TOKEN`'s), `LIGHTOTP_API_URL` (default `https://api.lightotp.com/SendMessage`), `LIGHTOTP_REQUEST_TIMEOUT_MS` (default `10000`). `FONNTE_API_TOKEN`/`FONNTE_API_URL`/`FONNTE_REQUEST_TIMEOUT_MS` are removed from `env.validation.ts`, `docker-compose.yml`, and every other active runtime path — no Fonnte-shaped environment variable remains read by any code path.
5. **OTP business/security rules (generation, hashing, expiry, attempt limits, resend cooldown, per-phone/IP rate limits, single-use, replay prevention) are entirely unchanged** — these are application-layer rules (`CryptoOtpService`, the rate-limit guards, the pending-registration/recovery-challenge state machines) that never delegated to Fonnte and do not delegate to LightOTP either; the provider is a pure delivery mechanism, never a security boundary.

### Alternatives Considered

* **Keep sending a `+`-stripped target "just in case," mirroring Fonnte's format defensively.** Rejected: LightOTP's documented `toPhoneE164` field explicitly requires the leading `+`; sending a stripped value would fail `InvalidphoneNumber` validation. Provider formatting must be derived from that provider's own real contract, never carried forward from a different provider's convention (this task's own explicit instruction).
* **Invent a template/message field to try to preserve the exact prior message text.** Rejected outright per explicit instruction — no such field exists in LightOTP's documented API; guessing one risks a silently-broken integration disguised as a working one.
* **Extend `VerificationMessagingPort.sendVerificationCode` with a new `languageCode`/customer-language parameter to at least control the WhatsApp message's language.** Rejected for this task: no existing caller threads a customer's language preference to this call site today; adding one is a genuine feature addition beyond a mechanical provider swap, out of this migration's scope.
* **Introduce a second `VerificationMessagingPort`-like abstraction specifically for LightOTP.** Rejected: the existing port is already provider-agnostic and sufficient; creating a second abstraction would violate this task's own "do not create a second abstraction unnecessarily" instruction.

### Consequences

#### Positive

* Zero application/domain-layer changes — the existing `VerificationMessagingPort` boundary (ADR-022) absorbed the provider swap exactly as a ports-and-adapters design is meant to.
* `PhoneNumber` sheds two Fonnte-specific formatting methods, leaving the shared domain value object provider-agnostic again (canonical E.164 in, canonical E.164 out).
* LightOTP's documented `idempotencyKey` support gives the adapter a free safety net against duplicate sends that Fonnte's contract never offered.

#### Negative

* **The application no longer controls the exact WhatsApp message text.** This is a real, disclosed product-visible change (the copy "your verification code to tavola is: ... powered by vegacore" cannot be reproduced through LightOTP's API), not a silently-accepted regression. Restoring custom message copy would require a different LightOTP plan/feature (if one exists) or a different provider entirely — a future product decision, not resolved here.
* A second real external SaaS dependency and failure domain, structurally identical in shape to the one Fonnte already was (ADR-022's own "Negative" consequence carries forward unchanged, just against a different vendor).

### Impact

Affects: `src/config/lightotp.config.ts` (new, replaces `fonnte.config.ts`), `LightOtpVerificationMessagingAdapter` (new, replaces `FonnteVerificationMessagingAdapter`), `PhoneNumber` value object (two Fonnte-specific methods removed), `env.validation.ts`, `configuration.module.ts`, `authentication.module.ts`, `docker-compose.yml`, `ENVIRONMENT_SETUP.md`, `AUTHENTICATION_ARCHITECTURE.md` §15.8 (rewritten in place to describe the current LightOTP contract, per that document's own "authoritative current specification" convention), `ARCHITECTURE_LOCK.md` (this ADR added to the locked table; ADR-022's row annotated), `PRODUCT_REQUIREMENTS.md` FR-01.1a, `DOMAIN_MODEL.md`, `EVENTS.md`, `TESTING_STRATEGY.md`, `README.md`, `PROJECT_ROADMAP.md`, `TASKS.md` (new migration report). Does not affect Customer identity rules, Owner email/password authentication, Owner provisioning, Employee authentication, phone-number normalization/canonical-E.164 architecture, or any Reservation-domain architecture (Phase 7.x).

### Post-Audit Remediation Note (2026-08-02, item M4)

A repository-wide audit flagged `LightOtpVerificationMessagingAdapter.sendVerificationCode` being `await`-ed inline inside `StartCustomerRegistrationUseCase`/`ResendCustomerRegistrationUseCase`/`StartCustomerPasswordResetUseCase`/`ResendCustomerPasswordResetUseCase` as a deviation from CLAUDE.md's "long-running operations must never block the request/response cycle" rule, since every other external-provider call in this codebase (OneSignal push, via `NotificationDeliveryProcessor`) goes through a BullMQ queue instead.

**Evaluated and intentionally not queued.** Unlike a push notification (a secondary side effect of an already-durably-recorded `Notification` row), the OTP send *is* the primary outcome these four use cases exist to produce, and the caller is synchronously told whether it succeeded (`VerificationMessagingFailedException` on failure) so the Customer isn't left believing a code is on its way when it isn't. Moving the send behind a queue would force one of two changes neither of which this remediation pass is authorized to make unilaterally: (a) make these endpoints return "accepted" before delivery is confirmed, silently dropping the existing fail-fast error contract these use cases (and their tests) depend on, or (b) have the request handler block on the queued job's completion anyway, which adds BullMQ's operational overhead without removing the blocking wait it exists to avoid. Either is a product/API-contract decision, not a mechanical infrastructure change, per `CHANGE_POLICY.md`'s "no architecture change without an explicit decision" gate — so it is recorded here as a **deliberate, accepted exception** to the general async-external-call rule rather than implemented speculatively. No code changed as a result of this note.

## ADR-025

### Title

OneSignal Identity Verification (amends ADR-007's Implementation Rule)

### Status

Accepted — architecture frozen alongside the Phase 9 pre-implementation freeze (`TASKS.md`'s "Phase 9 — Notification System: Pre-implementation architecture decisions"). Signing code (`OneSignalIdentityVerificationService`, ES256, unit-tested with a locally-generated test key pair) implemented 2026-07-25; no real `ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY` has been provisioned this session, so live signing against a real OneSignal app remains unverified.

**Delivery mechanism (owner-approved 2026-07-25, implemented same day):** Hybrid delivery matching current official OneSignal Identity Verification documentation (`documentation.onesignal.com/docs/en/identity-verification`):

1. **Initial token at authentication:** `onesignalIdentityToken: string | null` is attached to `POST /api/v1/auth/customer/login` and to `POST /api/v1/auth/refresh` when `actorType === User` (Customer). Non-Customer refreshes and unconfigured environments return `null` (signer fails closed — never fabricates an unsigned token).
2. **On-demand refresh endpoint:** `GET /api/v1/notifications/identity-token` (JwtAuthGuard + SessionVersionGuard) returns `{ token, expiresInSeconds }` for the caller's `User.id`, for app-open and for OneSignal's `addUserJwtInvalidatedListener` → `OneSignal.updateUserJwt` path.
3. **Wiring:** signer is bound behind `ONESIGNAL_IDENTITY_TOKEN_SIGNER` in a `@Global()` `PushIdentityModule` so Authentication and Notifications consume the port without a module cycle.
4. **Does not** change Tavola session/JWT semantics, RBAC, or the four original Customer inbox endpoints' ownership rules. External live OneSignal delivery remains separately blocked pending credentials.

### Date

2026-07-25

### Context

ADR-007 accepted OneSignal as the notification provider and froze one Implementation Rule: *"The application must never communicate directly with OneSignal. All notifications pass through: NotificationProvider."* It did not address how OneSignal itself authenticates the `external_id` a backend sends it. Current official OneSignal documentation (`documentation.onesignal.com/docs/en/identity-verification`, verified during the Phase 9 pre-implementation review, 2026-07-25) describes a real, documented risk: without Identity Verification, any client knowing or guessing another user's `external_id` can manipulate that user's OneSignal subscriptions via client-SDK calls, since OneSignal's default `external_id` matching performs no ownership proof. Tavola's own frozen decision (Phase 9 pre-implementation freeze, item 3) sets `external_id = User.id` — a UUID that, while not trivially guessable, is not treated as a secret anywhere else in the system (it already appears in JWTs, URLs, and API responses the Customer's own client legitimately sees) — so relying on its secrecy alone is not an adequate control.

This is not a new external dependency (OneSignal is already ADR-007-accepted) and does not change Tavola's own authentication/session model (`AUTHENTICATION_ARCHITECTURE.md` is untouched) — it is a narrow addition of cryptographic trust-proof specifically for OneSignal's own `external_id`/subscription endpoints, analogous in shape (a backend-held private key signing short-lived, narrowly-scoped tokens) to the already-established `PLATFORM_ADMIN_JWT_SECRET` pattern, just for a different, external-facing purpose.

### Decision

1. **Identity Verification is adopted.** The Tavola backend generates an ES256-signed (ECDSA P-256/SHA-256— the only algorithm OneSignal's Identity Verification accepts; per current OneSignal documentation, other algorithms are rejected) JWT proving ownership of a given `external_id` before OneSignal accepts subscription/identity operations for it.
2. **Signing ownership:** the backend only (never any client) — mirrors every other JWT-signing responsibility already centralized in `modules/authentication/`. The private key is never sent to a client.
3. **Key type:** ES256 private key, PEM format, issued from the OneSignal dashboard for the Tavola OneSignal app (an operational/dashboard action, out of this ADR's scope to perform).
4. **Configuration (name reserved, not created by this ADR):** `ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY` — naming mirrors the existing `LIGHTOTP_API_KEY`/`JWT_ACCESS_SECRET`/`PLATFORM_ADMIN_JWT_SECRET` convention already established in `env.validation.ts`. No value is created, printed, or handled by this ADR or the session that authored it.
5. **Trust boundary:** the resulting JWT proves only `external_id` ownership to OneSignal — it carries no Tavola session/authorization semantics of its own and is never accepted by any Tavola-side guard.
6. **Scope:** this ADR amends only ADR-007's Implementation Rule (the "how the app authenticates to/with OneSignal" detail) — ADR-007's provider choice, its Anti-Corruption Layer requirement, and every other part of that ADR are unchanged and not reopened, following the same narrow-amendment convention ADR-023/ADR-024 already established for ADR-013/ADR-022.

### Alternatives Considered

* **Rely on `external_id` matching alone, without Identity Verification.** Rejected: a real, currently-documented spoofing risk with no mitigating control elsewhere in the system: `User.id` is not treated as a secret today.
* **Mint a separate, Tavola-generated opaque token as the `external_id` instead of `User.id`, to reduce guessability, without adopting Identity Verification.** Rejected: security-through-obscurity, not a real ownership proof — a client-side SDK call with a leaked/observed opaque id would remain exactly as exploitable as one with a leaked UUID; also requires a new persistent id-mapping table Decision #3 of the Phase 9 freeze explicitly avoided introducing (no `PushSubscription`/`DeviceRegistration` table in v1).
* **Defer this decision entirely to a later phase.** Rejected: the risk is inherent in the identity model Phase 9 v1 already needs (`external_id = User.id`) — deferring it would mean shipping the vulnerable configuration first and hardening it later, a strictly worse ordering than deciding it now, before any implementation exists.

### Consequences

#### Positive

* Closes a real, currently-documented OneSignal-side spoofing vector before any implementation exists, rather than after.
* Reuses an already-established backend-signing-key pattern (`PLATFORM_ADMIN_JWT_SECRET`) — no new architectural shape, only a new instance of an existing one.

#### Negative

* One additional signing operation per relevant client session/app-open, and one new secret to provision and rotate operationally (out of this ADR's scope — an operational/deployment concern, not an architecture change).
* Ties Tavola's OneSignal integration to a specific OneSignal feature (Identity Verification) that would need re-evaluation if OneSignal is ever replaced — an acceptable, disclosed coupling given ADR-007's Anti-Corruption Layer already isolates this behind `NotificationProvider`, so a future provider swap only needs to review this ADR, not touch application/domain code.

### Impact

Affects: `docs/DECISIONS.md` (this ADR), `TASKS.md`'s Phase 9 pre-implementation freeze (item 3, cross-referenced), `docs/ARCHITECTURE_LOCK.md` (added to the locked ADR table). Does not affect `AUTHENTICATION_ARCHITECTURE.md`, Tavola's own JWT/session architecture, or any Reservation/Waitlist/Table domain architecture. No key, secret, or environment variable is created by this ADR — reserved for the implementation phase, under separate explicit authorization.

---

## ADR-026

### Title

Table Merge/Split Topology and Concurrency (references ADR-013 and ADR-023)

### Status

Accepted — implemented and live-verified 2026-07-26 (architecture frozen 2026-07-25, `TASKS.md` "Phase 6 — Merge/Split Tables: Final architecture freeze"; implementation and live verification recorded in `TASKS.md`'s "Phase 6 — Merge/Split Implementation & Verification Report").

### Date

2026-07-25

### Context

`DOMAIN_MODEL.md` has long described Merge/Split (shared `mergeGroupId`, status `Merged`, combined capacity as one reservable unit, reservation conflict rules). Phase 6 deferred the feature until the Reservation Engine existed; Phase 7.2 unlocked that dependency, but Status Management deliberately excluded `Merged`, `Reservation.tableId` still targets a single `Table`, and ADR-013's advisory locks are **time-bucket slot keys** (`branchId:tableId:date:bucket`), not table-topology locks. Implementing docs literally without a freeze would either invent a TableCombination aggregate (rejected) or race Merge against Create/Approve/Reschedule.

This ADR freezes the owner-approved Primary Table model and the concurrency extension required so topology mutation and reservation mutation cannot observe partial merge membership. It **references** ADR-013 and ADR-023; it does **not** rewrite their historical Decision text.

### Decision

1. **Identity — Primary Table (Option A).** A merge of N ≥ 2 existing Tables shares one `mergeGroupId`. Exactly one member is primary (`isMergePrimary = true`). `Reservation.tableId` for reservations against the merged unit is always the **primary** `Table.id`. No synthetic Table, no `TableCombination` aggregate, no second reservation-target abstraction.

2. **Split = undo merge only.** Clears `mergeGroupId` / `isMergePrimary` / secondary `Merged` status. Does not create or destroy Table rows; permanent `capacity` and Table IDs are unchanged. Historical reservations continue to reference the (former) primary `Table.id`.

3. **`TableStatus.Merged`.** Secondaries are `Merged` while in an active group (not independently reservable; not availability candidates). Primary remains `Available` when free and uses existing `reserve()`/`release()` ↔ `Reserved` when an Approved reservation targets the merged unit. `Merged` is never set via `POST /tables/:id/status`.

4. **Effective capacity.** Permanent `capacity` columns are never overwritten. `effectiveCapacity(primary) = SUM(member capacities)` while merged; unmerged tables use their own `capacity`. Mixed capacities allowed.

5. **Membership rules.** Same Branch, same FloorPlan, all `Available` at merge time, not already merged, no nested merges, min 2 distinct IDs. Primary selection: optional `primaryTableId` ∈ `tableIds`; else lowest `tableNumber`, then `Table.id` ascending.

6. **Reservation blocking.** Merge/Split rejected if any involved primary/component (Merge: every component; Split: the primary) has a **Pending** or **Approved** reservation whose `reservationEndTime` has not passed. Rejected/Cancelled/Expired and historical Completed/NoShow do not block. No automatic reservation reassignment; ADR-023 is not invoked by Merge/Split.

7. **Topology locking (extends ADR-013's concurrency *guarantee*, not its slot-key mechanism).** Inside one DB transaction, before conflict checks or mutation:
   1. Collect every involved `Table.id`.
   2. Sort IDs ascending.
   3. Acquire transaction-scoped PostgreSQL advisory locks for those table IDs (topology namespace).
   4. Re-read tables; re-check membership/status; re-check reservation conflicts; mutate; commit.

   **Compatibility with ADR-013/023:** Reservation Create, Approve, and Approved Reschedule (and Waitlist auto-approve paths that call `reserve()`) MUST also acquire the same **table-id topology lock(s)** for every `Table.id` they touch, **before** acquiring existing ADR-013/023 slot advisory locks, using the same sorted Table.id order. Slot-lock semantics of ADR-013/023 remain unchanged. This additive ordering (topology locks → slot locks) prevents Merge↔Create/Approve/Reschedule races and avoids cross-namespace deadlock.

8. **Schema (additive).** Reuse `mergeGroupId`. Add `isMergePrimary boolean NOT NULL DEFAULT false`. Invariant: `mergeGroupId IS NULL ⇒ isMergePrimary = false`; exactly one primary per active `mergeGroupId` (partial UNIQUE index when enforceable). Enum add `Merged`.

9. **API.** `POST /api/v1/tables/merge`, `POST /api/v1/tables/:tableId/split` (any member). Dual-actor auth: OrganizationMember Owner/Admin **or** Employee with `tables:manage` + branch assignment. No new permission slugs.

10. **Events / realtime.** Real domain events `TableMerged` / `TableSplit` with minimized payloads; audited; Phase 8 allow-list → existing staff `restaurant:{id}` + `branch:{id}` rooms only (no floor-plan room exists; no new room type). No Phase 9 notifications. **Audit attribution:** Employee → `actorType = Employee`, `actorId = Employee.id`; OrganizationMember Owner/Admin → existing TableMoved/TableStatusChanged convention (`actorType = User`, `actorId = OrganizationMember.userId`).

11. **Move / Status guards.** Any table in an active merge group cannot be Moved or ChangeTableStatus'd; Split first. Merge/Split alone set/clear secondary `Merged`.

12. **Dual-actor authorization (use-case branching).** Merge/Split routes use `JwtAuthGuard` + `SessionVersionGuard` only; authorization is resolved inside the use case: OrganizationMember Owner/Admin of the owning org **or** Employee with `tables:manage` + branch assignment. No NestJS OR-composed OrgRole/Permissions guards; no wholesale Table CRUD auth migration. ADR-026 satisfies `CHANGE_POLICY.md` criterion #4 for this narrow extension (distinct from Phase 7.0's still-deferred Manager-driven `employees:manage` composed-guard track).

### Alternatives Considered

* **Synthetic combination Table / TableCombination aggregate.** Rejected: breaks or expands `Reservation.tableId`; larger schema/API blast radius; owner-rejected.
* **Use `Disabled` instead of `Merged`.** Rejected: conflates operational disablement with topology membership; owner-rejected.
* **Rely on ADR-013 slot locks alone for Merge.** Rejected: slot keys are time-bucketed; cannot serialize topology mutation against arbitrary future Create/Approve.
* **Amend ADR-013 text in place.** Rejected per CHANGE_POLICY / ADR-023 precedent: extend via new sequentially numbered ADR.

### Consequences

#### Positive

* Preserves Reservation, ADR-013 slot locking, and ADR-023 two-key Reschedule unchanged at their cores.
* Gives a deterministic, implementable merge identity and capacity model.
* Closes the DOMAIN_MODEL vs Status Management `Merged` contradiction explicitly.

#### Negative

* Narrow additive lock acquisition on Create/Approve/Reschedule/Waitlist-reserve paths (topology lock before slot lock).
* New enum value and `isMergePrimary` column.
* Dual-actor authorization for Merge/Split differs from today's Owner/Admin-only Table CRUD routes (intentional, narrowly scoped; not a wholesale Table auth refactor).

### Impact

Affects: `DECISIONS.md` (this ADR), `ARCHITECTURE_LOCK.md`, `TASKS.md` Phase 6 freeze note, `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `EVENTS.md`, `API_GUIDELINES.md`, `AUTHORIZATION_ARCHITECTURE.md`. Implementation touches `modules/tables/**`, reservation create/approve/reschedule/waitlist lock ordering, realtime allow-list mapping, Prisma migration (forward/additive only). Does not alter ADR-013 or ADR-023 historical text. No Phase 9 / OneSignal impact.

---

## ADR-027

### Subscription System as Entitlement/Access Contract (Not Billing)

Status: **Implemented (2026-07-28).** Architecture frozen the same day (Phase 12 pre-implementation decision session); implementation authorized and delivered, live-verified, immediately after. `Subscription`/`SubscriptionPlan`/`SubscriptionUsage`/`RestaurantUsage` all exist and are live. No decision recorded in this ADR was reopened or altered during implementation — see `TASKS.md`'s "Phase 12 — Subscription System: Implementation" section for the implementation-time reconciliations (all non-architectural: an Employee soft-delete decrement mapping, the exact atomic-counter mechanism, default-plan provisioning wiring, a route-naming clarification, an `actorId` addition to 5 event payloads for audit consistency, a `DIRECT_TENANT_OWNED_MODELS` registration fix, and a `forwardRef` module-wiring fix for a genuine three-module dependency cycle).

Date: 2026-07-28

#### Context

Phase 12 — Subscription System was never implemented (confirmed: no Prisma model exists for any of these concepts). Prior documentation (`DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `EVENTS.md`, written 2026-07-07, before Payments was removed from product scope) modeled `Subscription` as a classic SaaS billing subscription: a `PastDue` status, `priceAmount`/`priceCurrency`/`billingInterval` fields on `SubscriptionPlan`, `SubscriptionUpgraded`/`SubscriptionDowngraded`/`SubscriptionRenewed` events, a `maxMonthlyReservations` limit, and an undocumented auto-suspend-on-lapse behavior tying `Subscription` expiration to `Restaurant.status`. None of this was ever implemented. Following the permanent removal of in-app payments from TAVLA's product scope (see this document's own Disposition note on ADR-021), this billing-shaped design could not proceed as documented and required an explicit pre-implementation architecture-decision session (40 numbered decisions, D1–D40) with the owner before any schema/code work could begin.

#### Decision

**Subscription = entitlement/access contract, never a billing subscription.** A restaurant/organization's plan is assigned/changed administratively by a Platform Admin; TAVLA models only the resulting entitlement, never how (or whether) money changes hands outside the platform.

1. **Ownership (reaffirms ADR-011, not reopened).** One `Subscription` per `Organization` (unique `organizationId`); plan assignment is always Organization-level, never per-Restaurant.
2. **`SubscriptionPlan`** — platform-global reference data (TENANCY.md, alongside `Country`/`Currency`/`Roles`), persisted and seeded (not dynamically CRUD-able in Phase 12; a read-only PlatformAdmin catalog endpoint is the only runtime surface). No commercial tier names (`Free`/`Basic`/…) are frozen by this ADR — the schema is generic; the catalog is business data, seeded separately. No `priceAmount`/`priceCurrency`/`billingInterval` — a Plan is never a priced product.
3. **Numeric limits — exactly three, all structural/resource limits, no reservation-volume limit:** `maxRestaurants` (Organization-wide), `maxBranchesPerRestaurant` (**per-Restaurant** — each individual Restaurant under the Organization may have at most this many Branches, not an Organization-wide total), `maxEmployeesPerRestaurant` (**per-Restaurant**, same semantics). **`maxMonthlyReservations` is explicitly excluded by owner decision** — a restaurant must never become unable to accept reservations because of its Organization's subscription tier; reservation-volume *measurement* is Phase 14 Analytics' concern, never a Phase 12 restriction. No limit exists for offers, reviews, images, tables, floor plans, realtime connections, notifications, waitlist entries, or customers unless separately approved in a future architecture decision.
4. **Two-tier usage tracking, matching each limit's actual enforcement grain — this is the resolution to a genuine cardinality mismatch caught during this session.** A single Organization-scoped counter cannot correctly enforce a *per-Restaurant* limit (it cannot distinguish "Restaurant A has 5 branches" from "Restaurant B has 0" — both would appear identically in an Organization-wide total). Therefore:
   - **`SubscriptionUsage`** (one row per Organization, direct tenant-owned) tracks only `restaurantCount`, enforcing `maxRestaurants`.
   - **`RestaurantUsage`** (new table, one row per Restaurant, transitively tenant-owned via `restaurantId -> Restaurant.organizationId`, same pattern as `RestaurantSettings`/`RestaurantGallery`/`Offer` — not added to `DIRECT_TENANT_OWNED_MODELS`) tracks `branchCount`/`employeeCount`, enforcing `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant` against the specific target Restaurant, never an Organization-wide sum.
   - Both are recalculated incrementally from domain events (`RestaurantCreated`, `BranchCreated`, `EmployeeCreated`), never a live `COUNT(*)`.
5. **Concurrency.** Atomic conditional counter update in the same transaction as the resource's own insert (`UPDATE ... SET count = count + 1 WHERE <key> = $1 AND count < $2`), keyed to each limit's own grain: `maxRestaurants` → `organizationId`-keyed update on `SubscriptionUsage`; `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant` → `restaurantId`-keyed update on `RestaurantUsage`. No advisory lock, no Redis lock, no read-count-then-insert race window.
6. **Lifecycle: `Active`, `Suspended`, `Cancelled`, `Expired`.** No `PastDue`/`Trialing`/other billing-derived state. `Suspended` = administrative pause (PlatformAdmin, reactivatable via Reactivate). `Cancelled` = terminal (resumed only via a fresh Assign, not Reactivate). `Expired` = automatic, `endsAt` elapsed, BullMQ-scheduled + CAS-guarded (mirrors the Offer expiration precedent, Phase 11) with a lazy-check fallback. No trials (no `trialEndsAt`).
7. **Assignment/change: PlatformAdmin-only.** No customer-facing purchase/checkout endpoint exists or is planned. `startsAt` + nullable `endsAt` (null = indefinite); no advance/`effectiveAt` scheduling; plan changes are immediate. Downgrade is **rejected outright** if the target plan's limits are exceeded by current usage — checked against `SubscriptionUsage.restaurantCount` for `maxRestaurants`, and against **every** Restaurant's own `RestaurantUsage` row (the maximum across all of the Organization's restaurants) for the two per-Restaurant limits. Never silently deletes/archives/auto-suspends resources.
8. **Enforcement is a new step in the existing use-case-level authorization sequence (not a new mechanism):** Authentication → tenant/actor RBAC → **Subscription entitlement** (one `SubscriptionPolicy` check, numeric and any future feature-boolean entitlement together) → domain/business-invariant policy. Enforced in the application layer, before resource creation (`CreateRestaurantUseCase`, Branch-creation use case, Employee-invite use case) — never in a controller, guard, or repository. `CreateReservationUseCase` has **no** subscription-entitlement dependency (item 3, above).
9. **An expired/suspended/cancelled Subscription blocks only new resource creation.** It never mutates `Restaurant.status`, never blocks existing reservation-taking, and gates no currently-completed feature (Reviews, Offers, Waitlist, Realtime, Notifications, Merge/Split) — explicitly correcting the pre-2026-07-28 `DOMAIN_MODEL.md` text that had `Restaurant.status` auto-transitioning to `Suspended` on subscription lapse (see Alternatives Considered). No new feature-entitlement gating of any existing capability is introduced by this ADR.
10. **Plan immutability.** Once any `Subscription.planId` references a `SubscriptionPlan`, that plan's limit columns are immutable in place (application-enforced). A limit change means seeding a new plan and migrating affected subscriptions to it via the normal plan-change path (item 7) — never editing a live, referenced plan's numbers. A plan may be `archivedAt`-marked (excluded from future assignment) without affecting existing subscribers.
11. **Existing-Organization compatibility.** Every existing Organization is backfilled with a `Subscription` row (default plan, `Active`, `startsAt = now()`, `endsAt = null`) and a `SubscriptionUsage` row (real one-time `COUNT(*)`) via a seed/backfill script — not embedded in the migration itself, not application-layer lazy provisioning. The default plan's limits must be validated against real production data before backfill runs, so no existing Organization is retroactively placed over any limit.
12. **Tenancy.** `SubscriptionPlan` — platform-global. `Subscription`, `SubscriptionUsage` — direct tenant-owned (`organizationId`; add to `DIRECT_TENANT_OWNED_MODELS` at implementation time). `RestaurantUsage` — transitively tenant-owned via `restaurantId`.
13. **Events (minimized, no PII):** `SubscriptionAssigned`, `SubscriptionPlanChanged`, `SubscriptionSuspended`, `SubscriptionReactivated`, `SubscriptionCancelled`, `SubscriptionExpired`. No `SubscriptionRenewed`/`Upgraded`/`Downgraded`, no `PlanCreated`/`PlanUpdated`.
14. **No Realtime, no Notification integration in Phase 12.** No concrete operational need identified; both are closed-by-default per existing allow-list conventions.
15. **Phase 14 boundary.** Phase 12 owns exactly the usage counters needed for the three approved limits. Phase 14 owns all historical/trend/comparative analytics, including any future reservation-volume reporting — which must never imply a subscription restriction.
16. **Absolute payment boundary (reaffirmed).** No `Payment`, `PaymentTransaction`, `Invoice`, `BillingAccount`, `PaymentMethod`, `CheckoutSession`, `paymentProvider`, `paymentStatus`, `amountPaid`, card details, wallet, deposit, charge, proration, or payment webhook is introduced by this ADR, now or implicitly in any future Phase 12 implementation, unless a separate future owner decision explicitly reverses the payment-removal decision.

#### Alternatives Considered

* **Keep `maxMonthlyReservations` as a fourth limit (original pre-2026-07-28 draft).** Rejected by explicit owner override: reservation volume is an operational/analytics concern (Phase 14), not a commercial gate — a restaurant must never lose booking capability by successfully doing business.
* **Single Organization-scoped `SubscriptionUsage` row carrying `branchCount`/`employeeCount` as flat totals (original pre-2026-07-28 draft).** Rejected: structurally cannot enforce a *per-Restaurant* limit — an Organization with Restaurant A at 5/5 branches and Restaurant B at 0/5 would read identically to one with both at 2.5/5 under a single aggregate number, either wrongly blocking B or wrongly allowing A. Split into `SubscriptionUsage` (org-scoped, `maxRestaurants` only) + new `RestaurantUsage` (restaurant-scoped) instead.
* **Auto-suspend `Restaurant.status` on Subscription expiration (original pre-2026-07-28 `DOMAIN_MODEL.md` text).** Rejected: (a) directly contradicts the owner-approved "no gating of currently completed features" / "existing organizations must not accidentally lose access" principles; (b) `RestaurantStatus.Suspended` is already a real, Owner/Admin-mutable field (`PATCH /restaurants/:id`) — a second, subscription-driven writer of the same field is a correctness hazard (which actor's suspension "wins"?). Enforcement stays scoped to blocking new creation only.
* **Redis-cached entitlement snapshot.** Rejected: no demonstrated performance need (entitlement checks gate low-frequency creation actions, not high-QPS paths); would also contradict the existing "no long-lived Redis cache as permissions/entitlement source of truth" convention (`NON_FUNCTIONAL_REQUIREMENTS.md`, `AUTHORIZATION_ARCHITECTURE.md` §18).
* **Fully normalized `PlanFeature`/`Entitlement` table.** Rejected for v1: no feature-entitlement is being activated in this ADR at all (item 9); a normalized table is premature machinery for a currently-empty feature-gate list. Typed columns are the established precedent (`RestaurantSettings`) and sufficient today.
* **Immutable/versioned plans or full entitlement-snapshotting into `Subscription`.** Rejected as more machinery than a small, seed-managed catalog (no dynamic authoring API) currently needs; archive-only plans (item 10) get the same "no silent retroactive change" safety property more cheaply.
* **Trials.** Rejected: no product requirement identified; composes cleanly on top of the frozen lifecycle later if ever needed (a trial is just a short-`endsAt` Subscription).

#### Consequences

##### Positive

* Closes the only remaining stale, pre-payment-removal, billing-shaped documentation in this codebase (`PastDue`, `SubscriptionUpgraded`, auto-suspend-on-lapse, `maxMonthlyReservations`) before any of it could be implemented.
* Resolves a genuine, owner-caught schema cardinality mismatch (per-Restaurant limits vs. an Organization-wide-only counter) at the architecture stage, before a migration could bake in the wrong grain.
* Reuses three proven precedents (Offer expiration's BullMQ+CAS shape, `RestaurantSettings`' transitively-tenant-owned shape, the existing `AUTHORIZATION_ARCHITECTURE.md` §16 deny-rule ordering) rather than inventing new mechanisms.
* Existing organizations cannot regress — deterministic backfill, no feature gating activated, no restaurant-operational-state mutation.

##### Negative

* Two usage-tracking tables (`SubscriptionUsage` + `RestaurantUsage`) instead of one, because the limits genuinely have different enforcement grains — irreducible complexity given `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant`'s own per-Restaurant semantics, not an arbitrary design choice.
* Plan catalog/limit values require a new seeded plan (not an in-place edit) for any future change, once any subscription references the old one — a deliberate trade-off for auditability over convenience.

#### Impact

Affects: `DECISIONS.md` (this ADR), `DOMAIN_MODEL.md` (Organization/Subscription/Restaurant Aggregates, Business Rules, Repositories, Domain Events), `DATABASE_SCHEMA.md` (Subscriptions/Subscription Plans/Subscription Usage rewritten, new Restaurant Usage table), `EVENTS.md` (Subscription Events rewritten), `AUTHORIZATION_ARCHITECTURE.md` §22, `TASKS.md`/`PROJECT_ROADMAP.md`/`PRODUCT_REQUIREMENTS.md` Phase 12 sections, `ARCHITECTURE_LOCK.md` (post-lock extensions table). No Prisma schema/migration in this session (architecture-freeze only; implementation requires separate explicit authorization). No changes to Reviews/Offers/Waitlist/Realtime/Notifications/Merge-Split modules. `CreateReservationUseCase` unaffected.

---

## ADR-028

### Title

Analytics Architecture — Operational Restaurant Analytics (Read-Only, No New Persistence)

### Status

**Accepted — architecture frozen 2026-07-28, implemented and live-verified the same day.** See `TASKS.md`'s Phase 14 Implementation & Verification Report for the full test/Docker/live-verification evidence.

### Date

2026-07-28

### Context

`DOMAIN_MODEL.md` has long listed `AnalyticsCalculator` and `AnalyticsPolicy` as standalone names with no further specification; `EVENTS.md` lists four placeholder Analytics events (`ReservationStatisticsGenerated`, `DailyReportGenerated`, `MonthlyReportGenerated`, `OccupancyCalculated`) and an `AnalyticsQueue` BullMQ entry, none ever implemented or elaborated; `PRODUCT_REQUIREMENTS.md`'s FR-13 referenced "WebSocket + REST" and "Revenue-ready reports" — both written 2026-07-07, before Payments was permanently removed from product scope (ADR-021 Disposition) and before Phase 8/9's actual realtime/notification allow-lists were frozen. `DECISIONS.md`'s Future Decisions list carried "Analytics architecture" as open since the original architecture baseline. Phase 14 — Analytics was never implemented (confirmed: no Prisma model, controller, or query port exists for it).

A two-session pre-implementation process (Owner Decision Reconciliation, then this Documentation Freeze) resolved 50 numbered owner decisions (D0–D50) reconciling Phase 14's scope against current persisted data. This ADR freezes only the architecture-significant subset of those decisions; the full formula/route registers live in `TASKS.md`'s Phase 14 section, not duplicated here.

One material finding from this session's repository re-verification changes the frozen query strategy: `Reservation.reservationDate` (a stored `@db.Date` column, distinct from `reservationStartTime`) is **not** reliably Branch-local. Tracing every reservation-creation/mutation code path found `create-reservation.use-case.ts` (Online/Phone/WalkIn, one shared use case) and `reschedule-reservation.use-case.ts` compute it via `Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate())` — the UTC calendar date of `reservationStartTime`, with no reference to `Branch.timezone` anywhere in either file. Only the Waitlist-conversion path (`waitlist-promotion.service.ts`) is branch-local by construction, because it reuses the client-supplied `preferredDate` day string instead of re-deriving from `reservationStartTime`. No shared helper reconciles the two approaches. For a branch ahead of or behind UTC, an evening/late-night booking's stored `reservationDate` can therefore be off by one calendar day from the branch's true service day on 3 of 4 paths. This is a pre-existing data-quality condition in already-implemented Phase 7 code, not something this ADR changes or authorizes fixing (out of scope — documentation/architecture session only).

### Decision

1. **Product scope.** Phase 14 v1 is operational restaurant analytics only: Reservation Reports (status counts, source breakdown, service-day trend, booking-created trend, completion/no-show/cancellation rate, average party size), Peak Hours, Customer Insights, Waitlist Analytics, Review Summary. It is explicitly **not** financial analytics, a BI warehouse, CRM, marketing attribution, a realtime analytics platform, a reporting/export engine, or PlatformAdmin BI.

2. **Data source and architecture.** Direct PostgreSQL reads over existing operational tables only — `Reservation`, `ReservationWaitlistEntry`, `Restaurant`, `Branch`, `Review` (`ReservationHistory` is not required by any frozen v1 formula — see Decision #9). Layering: `Controller → Query Use Case → AnalyticsQueryPort → Prisma/PostgreSQL implementation`, matching the existing Repository Pattern. No mutable Analytics aggregate or entity; rate/formula computation is stateless helper functions. No new Prisma model, table, materialized view, Redis cache, BullMQ queue/worker, event-sourced store, or warehouse in v1 — unless a future phase separately proves, with measured performance evidence, that one is required.

3. **Reservation-date service-day derivation (supersedes any assumption that `Reservation.reservationDate` is branch-local).** Because `reservationDate` is proven inconsistent across creation paths (Context, above), service-day trend bucketing MUST derive the branch-local calendar date at query time from `reservationStartTime AT TIME ZONE Branch.timezone` (or the equivalent correct Prisma/PostgreSQL expression), never from the stored `reservationDate` column. Booking-created trend bucketing applies the identical Branch-timezone conversion to `createdAt`. This is an additive read-side query rule; it does not modify `Reservation.reservationDate`'s stored value, its writers, or any other consumer of that column.

4. **Timezone contract.** `Branch.timezone` is authoritative for all operational analytics; `RestaurantSettings.timezone` never overrides it for this purpose (reaffirms D6). Timezone-bucketed series — service-day trend, booking-created trend, Peak Hours — require an explicit single `branchId` and are not exposed at Restaurant/Organization scope, so no endpoint can silently combine two branches' local calendar buckets into one misleading series. Restaurant/Organization-scope endpoints return only non-bucketed aggregates (status counts, source breakdown, rates, averages), which are timezone-agnostic by construction.

5. **Authorization — no new permission slug, no new guard-composition mechanism.** Authorized actors: Organization Owner/Admin (`OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)`), **or** an Employee holding the already-seeded `reports:view` permission slug (`prisma/seed.ts`, granted to `manager`), constrained by existing branch-assignment rules. Per the precedent ADR-026 (Merge/Split) and the Phase 7.3 Cancel/Reschedule dual-actor routes already established, this is resolved by **use-case-level actor-type branching**, not a NestJS OR-composed guard: the route carries `JwtAuthGuard` + `SessionVersionGuard` only; the use case checks `actor.actorType === 'OrganizationMember' && actor.orgRole in (Owner, Admin)` OR `actor.actorType === 'Employee' && actor.permissions.includes('reports:view') && branch-assignment check when a branchId is in scope`. This ADR itself satisfies `CHANGE_POLICY.md` criterion #4 for this authorization-model decision, exactly as ADR-026 did for its own narrow extension. IDOR behavior follows the existing convention (unknown/foreign-tenant resource → 404). `JwtAuthGuard`, `SessionVersionGuard`, tenant isolation, and branch-assignment enforcement are unmodified.

6. **Tenancy.** Organization → Restaurant → Branch, resolved through existing relationships exactly as `BranchesController`/`RestaurantRepository` already do (Restaurant loaded first, tenant-scoped; Branch resolved as its child). No `organizationId` column is added anywhere; no Analytics persistence model exists to own one. Employee-actor queries are additionally constrained by branch assignment. PlatformAdmin/`$systemContext` cross-tenant analytics remains out of scope for Phase 14 v1.

7. **REST only, no realtime/notification integration.** No changes to the Phase 8 realtime allow-list, `RealtimeGateway`, or `RealtimeEventPublisher`; no changes to Phase 9 `NotificationProvider`/`NotificationDispatcherService`. Analytics reads persisted state on request; it does not publish or consume domain events.

8. **Privacy boundary.** Every response is aggregate-only: counts, rates, and averages. No `ReservationGuest.fullName`/`phone`/`email`, no raw customer/guest lists, no OneSignal/push identifiers. Guest-backed reservations are exposed only as an aggregate count (`guestBackedReservationCount`); guest identity is never merged across records by phone/email/name (no such cross-record key exists in `ReservationGuest`). No k-anonymity threshold is introduced because no raw or near-raw list is ever returned.

9. **Cancellation rate — exact formula, no `ReservationHistory` dependency.** `CancellationRate = Cancelled-from-Approved / (Cancelled-from-Approved + Completed + NoShow)`, where `Cancelled-from-Approved` means `Reservation.status = Cancelled AND Reservation.approvedAt IS NOT NULL` — `approvedAt` is never cleared on cancellation, so this is an exact, directly-persisted fact requiring no join to `ReservationHistory` and no dependency on that table's row-completeness for older data.

10. **Occupancy is excluded, not approximated.** No exact or approximate occupancy percentage, and no historical capacity/merge-topology snapshot system, in v1. The schema has no capacity-history or topology-history table (`Table.mergeGroupId`/`isMergePrimary` reflect only current topology), so any occupancy percentage computed against historical reservations would silently misrepresent capacity at the time of booking. Reservation counts and Peak Hours remain available as defensible, non-occupancy demand signals. Occupancy remains deferred until a separately approved historical-capacity/topology architecture exists.

11. **Subscription/plan independence.** Analytics is not plan-gated (reaffirms ADR-027 §15's Phase 14 boundary: Phase 12 owns only its three structural entitlement counters; Phase 14 owns all historical/trend/comparative analytics and must never imply a subscription restriction). No coupling to `SubscriptionUsage`/`RestaurantUsage` as analytics storage.

12. **No payment/revenue analytics.** TAVLA does not process payments (ADR-021 Disposition); Phase 14 v1 has zero currency-denominated metrics.

13. **Consistency and range contract.** Direct-read consistency (no serializable analytics snapshot claimed); responses include a `generatedAt` timestamp inside the `data` payload (the shared `ResponseEnvelopeInterceptor` hardcodes `meta: {}` with no per-route override, so `generatedAt` cannot live in `meta`). Maximum query range 366 days. No hard SLA beyond the existing `NON_FUNCTIONAL_REQUIREMENTS.md` "Heavy Operations ≤30s" target for Analytics/Reports — no new, separately-proven guarantee is claimed by this ADR.

14. **Audit.** Ordinary Analytics GET requests do not create `AuditLog` rows, consistent with the existing convention (`AuditLog` writes are triggered only by explicit RBAC-denial calls or mutating-domain-event listeners — see `PermissionsGuard`/`AuditingEventPublisher` — and a read-only GET with no domain event and no denial path triggers neither).

### Alternatives Considered

* **Analytics warehouse / aggregate rollup tables / materialized views.** Rejected for v1: no measured performance evidence justifies the added consistency/operational complexity against a modular-monolith-scale dataset; direct reads over existing indexes are the simpler starting point (owner decision D3/D4).
* **BullMQ `AnalyticsQueue` worker computing async rollups.** Rejected for v1 for the same reason; the queue name remains a documented, unimplemented placeholder in `EVENTS.md`, not an authorization to build it.
* **NestJS-composed OR guard (`OrgRoleOrPermissionGuard`) for the dual-actor authorization.** Rejected: no such guard-composition mechanism exists anywhere in the codebase today; every prior dual-actor case (ADR-026 Merge/Split, Phase 7.3 Cancel/Reschedule) resolved the OR inside the use case instead, and introducing a new generic guard-composition primitive for Analytics alone would be a wider architectural change than this feature warrants.
* **Fix `Reservation.reservationDate`'s UTC-derivation at the write side (Create/Reschedule use cases) instead of deriving branch-local dates at analytics query time.** Rejected for this ADR: modifying `create-reservation.use-case.ts`/`reschedule-reservation.use-case.ts` is a Phase 7 production-code change requiring its own authorization, migration/backfill consideration for already-persisted rows, and is out of scope for a documentation-freeze session. Deriving the date at analytics query time is correct regardless of whether the write-side bug is ever fixed, and remains correct if it is.
* **Approximate historical occupancy from current table/merge topology.** Rejected (owner override, D9/D45/D47): presenting a topology-reconstruction estimate as occupancy would be mathematically misleading given no historical capacity/topology snapshot exists.

### Consequences

#### Positive

* Phase 14 becomes implementable against verified, exact-or-explicitly-chosen formulas with zero schema changes.
* Resolves a genuine latent data-quality inconsistency (`reservationDate`'s non-branch-local derivation) at the read layer without requiring a risky write-side migration first.
* Reuses every existing architectural primitive (Repository Pattern, dual-actor use-case branching, response envelope, tenant resolution) — no new cross-cutting mechanism introduced.

#### Negative

* Restaurant/Organization-scope endpoints cannot show timezone-bucketed trends/peak-hours directly (Branch scope required) — a real capability constraint, not a documentation gap, until/unless a future ADR approves a per-branch-separated multi-timezone series contract at higher scope.
* `Reservation.reservationDate`'s write-side inconsistency remains unfixed; every future consumer of that column (not only Analytics) should be re-evaluated against this ADR's finding.
* No comparison periods, exports, or realtime analytics in v1 — deferred, not eliminated, so a future phase may need a follow-up ADR if any of these are approved later.

### Impact

Affects: `DECISIONS.md` (this ADR), `PRODUCT_REQUIREMENTS.md` (FR-13 rewritten), `PROJECT_ROADMAP.md`/`TASKS.md` Phase 14 sections, `DOMAIN_MODEL.md` (`AnalyticsCalculator`, `AnalyticsPolicy`), `AUTHORIZATION_ARCHITECTURE.md` (`reports:view`, `AnalyticsPolicy`), `EVENTS.md` (Analytics Events, `AnalyticsQueue` — labeled deferred), `DATABASE_SCHEMA.md` (explicit no-new-tables note), `API_GUIDELINES.md` (Analytics Endpoints route register), `ARCHITECTURE_LOCK.md` (post-lock extensions table). No Prisma schema/migration, no production code, in this session. No changes to Phase 8 realtime, Phase 9 notifications, Phase 12 subscriptions implementation, or Payments (remains permanently removed).

---

## ADR-029

### Title

Performance / Load-Testing Tooling — k6 Adoption

### Status

**Accepted — architecture frozen 2026-07-30** (owner decision, Phase 15 Architecture Freeze session). **Implemented and live-verified 2026-07-30** under Phase 15's own frozen "Performance Testing" scope — see `TASKS.md`'s Phase 15 Implementation & Verification Report and Final Live Re-Verification Report for the full evidence trail (all four scripts under `apps/backend/scripts/k6/`, run against the rebuilt production image, raw summary-export artifacts preserved).

### Date

2026-07-30

### Context

`docs/TESTING_STRATEGY.md:44`'s Load Tests section has long deferred throughput/response-time SLO validation to run "ahead of Phase 15 (Optimization)... against staging," explicitly leaving tooling choice open: "Tooling choice (k6, Artillery, Gatling) is an open decision, tracked in DECISIONS.md's Future Decisions under 'Monitoring stack' adjacent work." This document's own Future Decisions list (`:1570`, below) lists "Monitoring stack" among the topics that "require an ADR before implementation" (`:1566`). The Phase 15 Pre-Implementation Audit (`TASKS.md`, 2026-07-30) confirmed no load-testing tool (k6/Artillery/autocannon) exists anywhere in the repository today — only a manual, threshold-free `apps/backend/scripts/perf-smoke.mjs` script and a concurrency-safety-only `apps/backend/test/load-smoke.e2e-spec.ts`. Because `CHANGE_POLICY.md`'s trigger #8 ("Adopts a technology listed under Future Decisions in `DECISIONS.md`") applies to the load-testing-tool sub-topic tracked under "Monitoring stack," a new ADR is required before implementation proceeds. This ADR satisfies that requirement; it does not resolve the broader Monitoring/Observability stack topic.

### Decision

1. **Tool.** Adopt **k6** as the project's official performance/load-testing tool. Artillery and Gatling are explicitly rejected for this purpose (owner decision).
2. **Scope of this ADR.** Resolves only the load-testing-tool sub-topic tracked under the "Monitoring stack" Future Decision, per `TESTING_STRATEGY.md:44`'s own framing. The broader Monitoring/Observability stack topic (metrics, tracing, log aggregation, alerting) remains an open Future Decision requiring its own future ADR.
3. **Integration model.** k6 is a standalone Go-binary test runner with its own embedded JS runtime — it is not a Node.js package and is not added to `apps/backend/package.json` `dependencies`/`devDependencies`. It runs as an external CLI (or the official `grafana/k6` Docker image) against a running instance of the stack, matching the existing precedent of `apps/backend/scripts/perf-smoke.mjs` (a host/Docker-run script outside the Jest suites, not inside them).
4. **Placement.** k6 scripts live under a new `apps/backend/scripts/k6/` directory, alongside the existing non-Jest `perf-smoke.mjs` — not under `apps/backend/test/` (Jest's tree), since k6 scripts are not Jest specs and do not run under the Jest test runner.
5. **Scope of first suite.** Per Phase 15's frozen implementation scope, the first k6 suite covers at minimum: Discovery, Reservation availability, Reservation creation, Analytics. Thresholds are sourced exclusively from `NON_FUNCTIONAL_REQUIREMENTS.md`'s existing targets (public API p95≤500ms/p99≤1s; reservation lookup <100ms; heavy-operation ≤30s) — no invented target.
6. **CI scope unchanged.** Per `TESTING_STRATEGY.md:44,95`, k6 runs remain out of the standard CI pipeline, executed on-demand/pre-release against a staging-like environment — this ADR does not change that scope.

### Alternatives Considered

* **Artillery.** Rejected (owner decision) — no repository evidence favored it, and it is an npm package, which would add to the Node dependency graph unlike k6's external-binary model.
* **Gatling.** Rejected (owner decision) — JVM-based, heavier operational footprint than warranted; no other JVM component exists anywhere in this project.
* **Continue relying on `perf-smoke.mjs`/`load-smoke.e2e-spec.ts` alone.** Rejected — neither asserts throughput/response-time thresholds against `NON_FUNCTIONAL_REQUIREMENTS.md`'s SLOs, and `TESTING_STRATEGY.md` itself already mandates real load testing "ahead of Phase 15."

### Consequences

#### Positive

* Resolves a Future Decision open since `TESTING_STRATEGY.md`'s original authoring, unblocking Phase 15's "Performance Testing" checklist item.
* No Node dependency-graph impact (k6 is external), consistent with the repository's existing pattern for non-Jest performance scripts.

#### Negative

* Introduces a new external tool that must be installed wherever load tests run (developer machines, staging runners) — not tracked in `package.json`, so its version should be pinned/documented separately (e.g., in `ENVIRONMENT_SETUP.md` or the new `scripts/k6/` directory) at implementation time.

### Impact

Affects: `DECISIONS.md` (this ADR), `docs/TESTING_STRATEGY.md` (tooling choice no longer open for the load-test sub-topic only), `TASKS.md` Phase 15 section (Performance Testing scope). No `package.json` dependency change (by design — k6 remains an external tool, per Decision #3). The four k6 scripts, shared config, and fixture seed/cleanup tooling were implemented and executed against the rebuilt production image in the Phase 15 Implementation & Verification session and re-executed with raw artifact capture in the subsequent Final Live Re-Verification session (`TASKS.md`).

---

## ADR-030

### Title

Messaging Tenancy Correction — Restaurant-Resolved Tenancy for Conversation

### Status

**Accepted — Phase 15.6 Architecture Design Session, 2026-07-30.** Supersedes ADR-020 Decision Item 1 only; items 2–5 of ADR-020 are unchanged and not reopened. Pre-implementation correction — no `Conversation`/`ConversationParticipant`/`Message` table, migration, or data existed before this session (Phase 15.6 was `⏳ Pending` in `TASKS.md`), so this is not a production tenancy-mechanism change, only a correction to an unimplemented specification.

### Date

2026-07-30

### Context

ADR-020 (2026-07-07) specified `Conversation`/`ConversationParticipant`/`Message` as "tenant-scoped via `organizationId`" — a direct column, mirrored verbatim into `DATABASE_SCHEMA.md`'s placeholder tables. Since then, ADR-011/ADR-012's tenant-isolation mechanism (`TENANCY.md`'s `withTenantScoping` Prisma extension + `DIRECT_TENANT_OWNED_MODELS` allowlist) has been repeatedly refined by real implementation experience: `ReservationWaitlistEntry` (Phase 7.5) had its originally-specified direct `organizationId` column dropped via a corrective migration because a Customer-initiated row has no bound `TenantContext.organizationId` to populate it with; `Reservation`, `Notification`, `Review`, and `Offer` all independently arrived at the same "no direct `organizationId`, resolve transitively via `restaurantId → Restaurant.organizationId`" shape (`TENANCY.md`). `Conversation` has the identical structural problem: a Customer starts a conversation, and a Customer actor has no bound `TenantContext.organizationId` to write into a required direct column — the same problem already solved four times over, not a new one.

### Decision

1. **No `organizationId` column** on `Conversation`, `ConversationParticipant`, or `Message`. `Conversation.restaurantId` (required) is the sole tenancy-relevant FK.
2. **Transitive resolution.** Tenancy resolves `Conversation.restaurantId → Restaurant.organizationId`, exactly like `Branch`/`Reservation`/`Review`/`Offer`. None of the three Messaging tables are added to `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`.
3. **Use-case resolution gate.** Every use case resolves the parent `Restaurant` via the already-tenant-scoped `RestaurantRepository` first (mirroring `CreateBranchUseCase`'s documented gate). A `restaurantId` belonging to another organization resolves to `null` → `RestaurantNotFoundException`/`ConversationNotFoundException`, IDOR-safe like every other cross-tenant lookup in this codebase. `organizationId` is read off the resolved `Restaurant` only when constructing domain events or audit entries — never persisted on a Messaging row.
4. **ADR-020 items 2–5 unchanged** — real-time delivery, `ConversationPolicy` authorization, optional `reservationId`, and attachment handling are not reopened by this ADR.

### Alternatives Considered

* **Keep the direct `organizationId` column, populate it via a branch/restaurant lookup at write time.** Rejected — this still requires the exact same `Restaurant` resolution step this ADR mandates, but additionally introduces a second, denormalized copy of the tenant id that can drift (e.g. a restaurant's organization changes) with no single source of truth.
* **Register `Conversation` in `DIRECT_TENANT_OWNED_MODELS`, using the `$systemContext` escape hatch for Customer-initiated creates.** Rejected — `$systemContext` is reserved for platform-admin/analytics/support tooling and must never appear inside `src/modules/**` (`TENANCY.md`); this would bypass fail-closed tenant scoping on every ordinary customer-facing write, the exact anti-pattern `TENANCY.md` already documents as wrong for Customer-owned/-spanning models.

### Consequences

#### Positive

* Consistent with every other transitively-tenant-owned model in the schema (`Branch`, `Reservation`, `Review`, `Offer`, `ReservationWaitlistEntry`) — no new tenancy shape introduced.
* No drift risk between a stored `organizationId` and the restaurant's actual current organization.
* Simpler write path: `StartConversationUseCase` never needs to resolve or store an `organizationId`.

#### Negative

* Every repository query needs a `restaurantId → Restaurant` resolution (or an explicit join) rather than a flat `WHERE organizationId = ...` filter — most visible in `ListRestaurantConversations` for an `OrganizationMember` listing across branches, which must join through `Restaurant`/`Branch` rather than filter a single column. This is the same cost every other transitively-tenant-owned model already pays.

### Impact

Affects: `DECISIONS.md` (this ADR; also see the Phase 15.6 Owner Decisions D1–D15 note under ADR-020), `DATABASE_SCHEMA.md` (Conversations/Messages tables — remove `organizationId`, document `restaurantId` as the sole tenancy FK), `DOMAIN_MODEL.md`, `TENANCY.md` (add `Conversation`/`ConversationParticipant`/`Message` to the transitively-tenant-owned list alongside `Branch`/`Reservation`/`Review`/`Offer`), new `modules/messaging/` bounded context.

---

## ADR-031

### Title

Menu Management Architecture — Phase 18 Freeze

### Status

**Accepted — Phase 18 Architecture Freeze, 2026-08-02. Architecture only — implementation not authorized.** No `Menu`/`MenuCategory`/`MenuItem`/`MenuItemOptionGroup`/`MenuItemOption`/`MenuItemAddOn` table, migration, or code exists before this session (`FR-08.1` in `PRODUCT_REQUIREMENTS.md` had no implementation phase, recorded as a gap in `TASKS.md`'s Phase 15.5 note). This ADR resolves that gap by design only; a separate explicit go-ahead is required before any Prisma migration or code is written.

### Date

2026-08-02

### Context

`PRODUCT_REQUIREMENTS.md`'s `FR-08.1` ("Menus, categories, items") has never had an assigned implementation phase or schema design. The platform needs a production-grade Menu Management module — one Menu per Restaurant, containing Categories, containing Menu Items, each with configurable Option Groups/Options and Add-ons, image support via the existing File infrastructure, and Always/Unavailable/Scheduled availability — without inventing a new architecture pattern. Everything must follow the same Clean Architecture / DDD / repository-pattern conventions already established by `Restaurant`/`Branch`/`Table`/`Offer`.

### Decision

1. **Six new Prisma models**, all soft-deletable (`deletedAt: Date | null`, matching the `Offer`/`Branch` convention exactly, never `isDeleted` booleans): `Menu`, `MenuCategory`, `MenuItem`, `MenuItemOptionGroup`, `MenuItemOption`, `MenuItemAddOn`. See `DATABASE_SCHEMA.md` for full field lists.
2. **Singleton Menu per Restaurant**, enforced by a `@@unique([restaurantId])` constraint plus an application-layer existence check in `CreateMenuUseCase`. The DB-level interaction between this uniqueness constraint and soft-delete (can a new Menu be created after the old one is soft-deleted?) is **left open** — see Remaining Decisions in the Phase 18 report; it does not block the freeze because it is a migration-time detail, not a domain-model detail.
3. **Transitively-tenant-owned**, exactly like `Branch`/`Reservation`/`Review`/`Offer` (`TENANCY.md`): every one of the six models carries a direct `restaurantId` FK and **no `organizationId` column**; none are added to `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`. `MenuCategory`, `MenuItem`, `MenuItemOptionGroup`, `MenuItemOption`, and `MenuItemAddOn` additionally denormalize `restaurantId` directly (not just their immediate parent FK), mirroring `Table`'s existing denormalization of `floorPlanId` alongside `branchId` — this keeps every tenancy resolution a single hop through `RestaurantRepository` regardless of nesting depth, rather than requiring a multi-hop walk up the Category→Menu→Restaurant chain on every read.
4. **Money as `Decimal(10, 2)`**, matching `Offer.discountValue` — not integer cents. `MenuItem.price`/`MenuItemOption.priceModifier`/`MenuItemAddOn.price` all follow this. `MenuItem.currency` is a plain nullable `String` (ISO 4217 code), matching the existing `Branch.currency` free-text convention — no new currency enum introduced.
5. **Images reuse the existing polymorphic `FileRecord` mechanism unchanged.** `FileOwnerType` already includes `'Menu'` (`file-record.entity.ts`) — no File module change is required. `MenuCategory.imageFileId`/`MenuItem.imageFileId` are bare nullable UUID columns (no Prisma relation), exactly like `Restaurant.logoId`; `ownerType = 'Menu'`, `ownerId` = the specific `MenuCategory.id`/`MenuItem.id`. Signed read URLs are resolved at read time and never persisted, per `AddRestaurantGalleryImageUseCase`'s existing pattern.
6. **Options and Add-ons are relational entities, not a JSON blob.** `MenuItemOptionGroup` → `MenuItemOption` (1:N) and `MenuItem` → `MenuItemAddOn` (1:N) are modeled as first-class tables with their own repositories, matching this codebase's consistent preference for typed relational entities over `Json` columns for anything with independent validation rules (`minSelections`/`maxSelections`/`required`) — `Json` columns in this schema (`Branch.openingHours`, the new `MenuItem.scheduleJson`) are reserved for genuinely unstructured or purely-descriptive data, not domain entities with invariants.
7. **`displayOrder` reorder is a new bulk-update pattern** — no prior precedent existed anywhere in the schema (`RestaurantGallery.sortOrder` is assigned once on insert via `max()+1`, never bulk-reordered). `PATCH .../categories/reorder` and `PATCH .../items/reorder` accept a complete ordered array of sibling IDs and replace all `displayOrder` values in one transaction; a partial or foreign-ID array is rejected (set-equality check against the current sibling set). This pattern is documented in `API_GUIDELINES.md` as a reusable convention for future modules needing the same capability.
8. **New permission slug `menu:manage`**, following the existing `<resource>:<action>` convention (`AUTHORIZATION_ARCHITECTURE.md`), enforced via `@RequirePermission('menu:manage')` per-controller (never a global `APP_GUARD`, matching every other mutating module). Owner/Admin (`OrganizationMember` role hierarchy) retain full access without needing the slug, exactly as for every other Employee-RBAC-gated resource. Customer-facing read endpoints require no permission slug (public, unauthenticated).
9. **No integration with Reservations, Reviews, Offers, Messaging, Analytics, Notifications, or Realtime.** Discovery exposes only a derived `Restaurant.hasMenu: boolean` (true iff an active, non-deleted `Menu` exists) — no search, no indexing, no recommendation surface. `Offer → MenuItem` reference is documented as a future-phase possibility only (see Future Compatibility in the Phase 18 report) and is explicitly not implemented now.

### Alternatives Considered

* **Model Options/Add-ons as a `Json` column on `MenuItem`.** Rejected — `minSelections`/`maxSelections`/`required`/per-option pricing are independently validated, independently mutable, independently soft-deletable data with their own lifecycle; a `Json` blob would push that validation into application code with no DB-level integrity and no independent audit trail per option, breaking from this codebase's established preference for relational modeling of anything with real invariants.
* **Denormalize `organizationId` directly onto Menu/Category/Item for simpler queries.** Rejected for the same reason ADR-030 rejected it for Messaging — a second, driftable copy of the tenant id with no single source of truth. The `restaurantId`-denormalization-per-row approach (Decision Item 3) gets the query-performance benefit without the drift risk, since `restaurantId` is immutable once a row is created (never reassigned to a different restaurant).
* **Enforce "exactly one Menu per Restaurant" purely at the application layer, no DB constraint.** Rejected — a bare application-layer check is a well-known race condition under concurrent requests; a `@@unique([restaurantId])` constraint is the correct primary guard, with the soft-delete interaction left as an explicit open item rather than silently accepting the race.

### Consequences

#### Positive

* Zero new architecture patterns introduced — Menu Management is a straightforward application of already-proven conventions (soft delete, transitive tenancy, `Decimal` money, polymorphic `FileRecord` images).
* No File/MinIO module changes required at all — `FileOwnerType.Menu` was already reserved, confirming the existing infrastructure was designed with this module in mind.
* The bulk-reorder pattern, once implemented, becomes available to any future module needing ordered siblings (e.g., a future multi-menu-per-restaurant ordering), rather than being a one-off.

#### Negative

* `restaurantId` denormalization onto five tables (Decision Item 3) is more columns to keep consistent than a pure parent-chain walk would need, though the risk is bounded since the column is write-once.
* The Menu-per-Restaurant uniqueness/soft-delete interaction is deliberately left unresolved by this freeze (see Remaining Decisions) — implementation cannot begin on `CreateMenuUseCase`/the Prisma migration until it is settled.
* Twenty-two distinct domain events across six entities (see `EVENTS.md`) is a larger event surface than most single-phase freezes in this codebase; justified by one-event-per-mutating-use-case audit-trail completeness (matching the Reservation module's granularity), but worth confirming during implementation that this doesn't produce excessive audit-log volume for high-churn menus.

### Impact

Affects: `DECISIONS.md` (this ADR), `DOMAIN_MODEL.md` (new Menu Aggregate), `DATABASE_SCHEMA.md` (six new tables), `EVENTS.md` (new Menu event catalog), `AUTHORIZATION_ARCHITECTURE.md` (new `menu:manage` slug), `TENANCY.md` (six new transitively-tenant-owned models), `API_GUIDELINES.md` (new bulk-reorder endpoint convention), `PRODUCT_REQUIREMENTS.md` (`FR-08.1` now points to Phase 18), `PROJECT_ROADMAP.md` / `TASKS.md` (new Phase 18 entry), `ARCHITECTURE_LOCK.md` (post-lock extension entry), new `modules/menus/` bounded context (not yet created).

---

## ADR-032

### Title

Menu Ownership, Availability, and Featured-Item Reconciliation — Phase 18 Correction (supersedes ADR-031 Decision Item 2 and the `MenuItem.scheduleJson` field only)

### Status

**Accepted — Phase 18 Architecture Reconciliation, 2026-08-03.** Supersedes only ADR-031 Decision Item 2 (singleton Menu) and the `scheduleJson` field documented in `DATABASE_SCHEMA.md`'s Menu Items table (that field was never a numbered ADR-031 Decision item in its own right, only a schema-level consequence of it). ADR-031 Decision Items 1, 3, 4, 5, 6, 7, 8, 9 are unchanged and not reopened. Pre-implementation correction, exactly like ADR-030's relationship to ADR-020 — no `Menu`/`MenuCategory`/`MenuItem`/`MenuItemOptionGroup`/`MenuItemOption`/`MenuItemAddOn` table, migration, or code exists before this session, so this is not a production schema change, only a correction to an unimplemented specification. Implementation remains unauthorized by this ADR.

### Date

2026-08-03

### Context

A Phase 18 architecture reconciliation was requested to re-open exactly five points of ADR-031 before implementation begins: (D1) Menu ownership cardinality, (D2) the shape of `MenuItem` availability data, (D3) `displayOrder` consistency across the aggregate, (D4) whether `MenuItem.isFeatured` belongs in v1, and (D5) whether `MenuItem.sku` belongs in v1. All other ADR-031 decisions remain frozen.

**D1.** ADR-031 Decision Item 2 froze a singleton Menu per Restaurant (`@@unique([restaurantId])`), leaving its own uniqueness/soft-delete interaction as an explicitly open Remaining Decision. The product surface this platform targets (breakfast/lunch/dinner/drinks/seasonal/Ramadan/QR/delivery menus, eventual POS integration) structurally requires more than one Menu per Restaurant. `Menu.displayOrder` and `Menu.active` already exist as columns in the frozen schema specifically "reserved for a future multi-menu-per-restaurant capability" (`DATABASE_SCHEMA.md`), meaning ADR-031 itself anticipated this reopening without acting on it.

**D2.** ADR-031's `MenuItem.scheduleJson` was justified as "following the `Branch.openingHours` `Json`-column precedent." That precedent is stale: `DATABASE_SCHEMA.md`'s own Branch section documents that `Branch.openingHours` is "pre-existing technical debt... `NULL`/unused by any code... structurally superseded by `BranchWorkingHours`" — a relational table (`dayOfWeek`, `openingTime`, `closingTime`, `breakStartTime`, `breakEndTime`, unique on `(branchId, dayOfWeek)`) built in Phase 5.2, mirroring an identical Restaurant-level `WorkingHours` table built in Phase 4.3. This codebase has adopted the relational day-of-week-schedule shape twice already; ADR-031 cited the one column this same document flags as dead technical debt, not the codebase's actual convention.

**D3.** Re-examination of the already-frozen `DATABASE_SCHEMA.md` field lists confirms `displayOrder` already exists on all six ADR-031 entities (`Menu`, `MenuCategory`, `MenuItem`, `MenuItemOptionGroup`, `MenuItemOption`, `MenuItemAddOn`). No gap exists; this topic is closed with no change.

**D4/D5.** `isFeatured` and `sku` were evaluated against this codebase's established discipline of not speculatively expanding schema ahead of a real consumer (`DATABASE_SCHEMA.md`'s "Candidate index... not frozen, not created in this session" precedent at the `MenuItem` availabilityMode note, and ADR-031's own deferral of `Offer → MenuItem` to "a future-phase possibility only").

### Decision

1. **Restaurant 1:N Menu.** Drop ADR-031 Decision Item 2's `@@unique([restaurantId])` constraint entirely. A Restaurant may own any number of non-deleted `Menu` rows. Add `Menu.isDefault: Boolean @default(false)`, distinct from the existing `Menu.active` (which continues to mean "enabled/visible," independent of default status). Exactly one non-deleted Menu per Restaurant may have `isDefault = true`, enforced by a hand-written partial unique index in the migration SQL (`menus_restaurant_one_default_key` on `(restaurant_id) WHERE is_default = true AND deleted_at IS NULL`) — the identical mechanism already proven in production for `Table.isMergePrimary` (ADR-026's `tables_merge_group_one_primary_key`), not a new pattern. This simultaneously resolves ADR-031's own open "uniqueness vs. soft-delete" Remaining Decision: because the constraint is now scoped to `isDefault = true AND deletedAt IS NULL` rather than to every row for a Restaurant, a Restaurant can always create additional (non-default) Menus, and a soft-deleted default Menu no longer blocks a new one from taking its place. `Restaurant.hasMenu` (Discovery) and the Customer public "the menu" read continue to derive from the single active, non-deleted, default Menu, preserving ADR-031 Decision Item 9's "no integration beyond `hasMenu`" scope unchanged — Discovery does not gain multi-menu awareness in this reconciliation.
2. **`MenuItemAvailability` relational table replaces `scheduleJson`.** New table: `id`, `menuItemId`, `restaurantId` (denormalized, matching every sibling Menu-family table), `dayOfWeek` (Int, 0–6), `startTime`/`endTime` (String, `"HH:mm"`, matching `BranchWorkingHours.openingTime`/`closingTime`'s exact type convention), `createdAt`, `updatedAt` — no `deletedAt`, matching `WorkingHours`/`BranchWorkingHours`'s existing precedent of whole-set replacement rather than soft-deleted history for schedule rows. Multiple rows per `dayOfWeek` are permitted (unlike `WorkingHours`'s one-row-per-day shape) because a Menu Item may have more than one serving window in a day (e.g., available at breakfast and dinner but not lunch) — this is the actual differentiator over `Json`, not merely "relational vs. not." Rows exist only while `MenuItem.availabilityMode = Scheduled`; a whole-set bulk-replace endpoint (`PATCH .../items/:itemId/availability`, body `{ windows: Array<{dayOfWeek, startTime, endTime}> }`) reuses `API_GUIDELINES.md`'s existing bulk-reorder-style whole-set-replacement convention rather than inventing a second one. `MenuItem.availabilityMode` itself is unchanged (`Always`/`Unavailable`/`Scheduled`).
3. **`MenuItem.isFeatured: Boolean @default(false)`, added now.** A pure, independently-mutable display flag with no cross-entity invariant, no state machine, and no dependency on any not-yet-built external system — the same shape as the already-frozen `MenuItemOption.active`/`MenuItemAddOn.active`. Adding it in the same freeze as the other four Menu Item scalar fields costs one column; deferring it would cost a full future ADR + migration cycle under this project's `CHANGE_POLICY.md` for a field with no design risk to wait out. No Discovery/ranking integration is implied or added — `isFeatured` is read-only-relevant to the Menu Item's own public representation, consistent with ADR-031 Decision Item 9's integration boundary.
4. **`displayOrder` — no change.** Confirmed present and consistent across all six ADR-031 entities already; D3 is closed with no schema action.
5. **`MenuItem.sku` — not added.** Unlike `isFeatured`, `sku`'s correct shape (uniqueness scope: per-Restaurant? per-Organization? globally? barcode/GTIN distinction? per-option-variant SKUs?) is entirely dictated by a POS/Inventory/ERP integration contract that does not exist anywhere in this codebase yet. Adding a nullable column now buys nothing — a nullable `String?` can be added later with zero migration cost to existing data — while guessing the wrong uniqueness scope today would itself require a corrective migration later, the exact asymmetry ADR-031 Decision Item 2's singleton mistake (D1, above) illustrates avoiding. `sku` remains an explicit future-phase item, tracked the same way ADR-031 already tracks `Offer → MenuItem`.

### Alternatives Considered

* **Keep the singleton Menu and add per-Branch or per-daypart fields directly on the existing single `Menu` row instead of allowing multiple Menu rows.** Rejected — a daypart (breakfast/lunch/dinner) or channel (QR/delivery) menu each has its own Categories/Items/structure, not just a different subset of one shared tree; modeling that as flags on a single Menu row would require inventing a parallel filtering mechanism across every child table instead of the one already-proven partial-unique-default pattern.
* **Keep `scheduleJson`.** Rejected — its sole justification (`Branch.openingHours` precedent) is documented, in this same schema, as dead code; the actual repeated convention for "day-of-week + time window" in this codebase is relational (`WorkingHours`, `BranchWorkingHours`).
* **Model `MenuItemAvailability` as one row per `dayOfWeek` (unique constraint), matching `WorkingHours` exactly.** Rejected — a Menu Item's realistic availability shape (multiple disjoint windows per day) is narrower than a Branch's single open/close window; forcing one row per day would silently drop the multi-window case `Json` could already express, which would be a regression, not a neutral change.
* **Add `sku` now as a nullable, unconstrained `String`.** Rejected — a nullable column with no consumer and no validated uniqueness scope is not "free" the way `isFeatured` is; a POS/Inventory ADR must define the scope before the column is added, or the column risks being redefined (breaking) once that integration actually arrives.

### Consequences

#### Positive

* Resolves ADR-031's own previously-open "Menu-per-Restaurant uniqueness/soft-delete interaction" Remaining Decision as a side effect of the D1 redesign, rather than leaving it open into implementation.
* Reuses two already-production-proven patterns (`Table.isMergePrimary`'s partial unique index; `BranchWorkingHours`'s relational day/time shape) instead of introducing either as new architecture — consistent with CLAUDE.md's "never sacrifice architecture for speed" read the other way: no new pattern is justified when a proven one already fits.
* Avoids a costly future breaking migration + `VERSIONING.md` API-version bump that would otherwise be needed the first time a Restaurant requests a second Menu (breakfast/lunch split, QR menu, etc.) after Phase 18 ships as originally frozen.

#### Negative

* Every Menu-scoped management endpoint path must include a `:menuId` segment it did not need under the singleton design (e.g. `.../menus/:menuId/categories/reorder` instead of `.../menu/categories/reorder`) — a real, if mechanical, change to `API_GUIDELINES.md`'s Phase 18 route shapes, none of which were implemented yet, so no breaking change to any live route.
* `MenuItemAvailability` adds a seventh Menu-family table and four new domain events (`MenuSetAsDefault`, `MenuItemFeatured`, `MenuItemUnfeatured`, `MenuItemAvailabilityWindowsReplaced`) to an already-large 22-event catalog (now 26) — see `EVENTS.md`; same audit-volume caveat ADR-031 already flagged applies with slightly larger surface.
* A Customer-facing "the menu" experience must now explicitly pick the default Menu (or let the Customer switch between Menus) rather than trivially rendering "the" Menu — a product/UX decision Phase 18's original single-Menu framing did not have to make, deferred to implementation.

### Impact

Affects: `DECISIONS.md` (this ADR), `ARCHITECTURE_LOCK.md` (ADR-031 row annotated "corrected by ADR-032," new ADR-032 row added to the post-lock extensions table), `DATABASE_SCHEMA.md` (Menu: drop singleton unique, add `isDefault` + partial unique index; MenuItem: drop `scheduleJson`, add `isFeatured`; new `MenuItemAvailability` table), `DOMAIN_MODEL.md` (Menu Aggregate notes, entity list, repository list, event count), `EVENTS.md` (four new Menu events, two corrected event descriptions), `TENANCY.md` (add `MenuItemAvailability` to the transitively-tenant-owned Menu-family list), `API_GUIDELINES.md` (Menu reorder/availability route shapes now include `:menuId`), `PROJECT_ROADMAP.md` / `TASKS.md` (Phase 18 goals updated). Implementation remains unauthorized.

---

# Future Decisions

The following topics require an ADR before implementation:

* Dedicated search engine adoption threshold and operations (storage/query ADR-018 Phase 2 — interface defined)
* Reporting engine
* Monitoring stack
* CI/CD pipeline
* Multi-language strategy (content translation storage — see LOCALIZATION.md for the mechanism already adopted for UI/notification locale; this entry now refers specifically to translatable *business content*, e.g., restaurant descriptions and menu items, which remains open)
* Event-driven architecture (cross-service domain events for a future microservices split — distinct from the WebSocket fan-out solved by ADR-015)
* Message broker adoption (Kafka/RabbitMQ/NATS for future microservices migration)
* Microservices migration strategy
* Backup and disaster recovery
* Observability stack
* Feature flags (storage/evaluation mechanism — the `FeatureFlags` table in DATABASE_SCHEMA.md provides storage only; a full ADR on evaluation/rollout strategy remains open)
* Distributed caching strategy
* PostgreSQL Row-Level Security as a defense-in-depth layer on top of ADR-012 (deferred pending connection-pooling-mode decision)
* Partner API key management and rate tiers
* White-label deployment topology (single-tenant vs multi-tenant branding)

**Removed (2026-07-28):** *Payment provider integration* was previously listed here as an open future ADR topic. Owner decision (2026-07-28) permanently removed in-app payments from TAVLA's product scope — see ADR-021's Disposition note, `PRODUCT_REQUIREMENTS.md`, and `TASKS.md`/`PROJECT_ROADMAP.md` Phase 13. This is no longer an open decision to revisit; it is a closed, decided-against topic, not a deferral.

**Resolved (no longer open):** API versioning strategy — see `VERSIONING.md` and `/api/v1` prefix. **Analytics architecture** — see ADR-028 (implemented and live-verified 2026-07-28). **Performance/load-testing tooling (k6)** — see ADR-029 (architecture frozen 2026-07-30, not yet implemented); this resolves only the load-testing-tool sub-topic previously tracked under "Monitoring stack" below — the broader Monitoring/Observability stack topic (metrics, tracing, log aggregation, alerting) remains open.

---

# Rules

Every significant architectural decision must:

1. Be documented before implementation.
2. Include rationale and alternatives.
3. Record trade-offs.
4. Describe long-term consequences.
5. Remain immutable after acceptance unless superseded by a new ADR.
