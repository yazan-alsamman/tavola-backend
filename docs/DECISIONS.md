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
* Email providers
* SMS providers

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

---

## ADR-021

### Billing Invoices

Status: Accepted (Architecture Compliance Audit 2026-07-07)

Date: 2026-07-07

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

# Future Decisions

The following topics require an ADR before implementation:

* Payment provider integration
* Dedicated search engine adoption threshold and operations (storage/query ADR-018 Phase 2 — interface defined)
* Analytics architecture
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

**Resolved (no longer open):** API versioning strategy — see `VERSIONING.md` and `/api/v1` prefix.

---

# Rules

Every significant architectural decision must:

1. Be documented before implementation.
2. Include rationale and alternatives.
3. Record trade-offs.
4. Describe long-term consequences.
5. Remain immutable after acceptance unless superseded by a new ADR.
