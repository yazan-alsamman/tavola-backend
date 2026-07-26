# DATABASE SCHEMA

## Enterprise Restaurant Reservation Platform

Version: 1.1

---

# Design Principles

The database must be:

* Fully normalized (3NF or higher where practical)
* Optimized for read-heavy workloads
* ACID compliant
* Multi-tenant aware
* Highly indexed
* Easy to extend
* Audit friendly

**Multi-tenant aware**, concretely: `organizationId` (introduced by ADR-011) is the outermost tenant-scoping column, propagated onto every tenant-owned table either directly or transitively (e.g., `Reservations.restaurantId → Restaurants.organizationId`). The isolation mechanism enforcing this at query time is defined in ADR-012 and TENANCY.md, not in this document — this document defines the shape of the data, not the enforcement mechanism.

---

# Core Entities

## Organizations

Purpose

The tenant boundary for the entire platform (see ADR-011, ADR-012). Every Restaurant belongs to exactly one Organization.

Fields

* id (UUID)
* name
* slug
* status (`Active`, `Suspended`, `Closed`)
* billingEmail
* createdAt
* updatedAt
* deletedAt

Indexes

* slug

---

## Organization Members

Purpose

Links a User to an Organization with an administrative role. Replaces the previous single `Restaurant.ownerId` model.

Fields

* id (UUID)
* organizationId
* userId
* role (`Owner`, `Admin`, `Billing`, `Staff`)
* invitedAt
* joinedAt
* status (`Invited`, `Active`, `Removed`)
* createdAt
* updatedAt

Indexes

* organizationId
* userId
* composite unique (organizationId, userId) — a user holds at most one membership role per organization

---

## Users

Purpose

Stores both Restaurant Owner/staff (email-identity) and customer (phone-identity) accounts on one shared table — see ADR-022 (2026-07-22) for why no actor-discriminator column is introduced.

Fields

* id (UUID)
* firstName
* lastName
* email (nullable as of ADR-022 — required in practice only for administratively-provisioned Restaurant Owner accounts; never collected for customer registration)
* phone (nullable — required in practice only for customer accounts; canonical E.164; see ADR-022 §"Phone-uniqueness enforcement mechanism")
* username (**new, ADR-022** — nullable; required in practice only for customer accounts; 3–30 chars, letters/numbers/underscore, globally unique case-insensitively; absent for Owner rows; mutability of this field beyond initial registration is out of this phase's scope)
* passwordHash
* avatarId
* language
* preferredCurrency
* notificationOptIn (default `true`) — opt in to transactional/functional notifications
* marketingOptIn (default `false`) — opt in to marketing communications; defaults to opted-out per GDPR
* status (`Pending`, `Active`, `Suspended`, `Locked`, `Deleted`, `Anonymized`) — see AUTHENTICATION_ARCHITECTURE.md §3
* emailVerified (**deprecation candidate, ADR-022** — no remaining consumer: Owner accounts are administratively provisioned with no verification step; customers never had email. Not removed in this documentation-only change; flagged for the future implementation phase.)
* failedLoginCount
* lockedUntil (nullable)
* permissionsVersion
* sessionVersion (monotonic — increment invalidates all JWTs globally; see AUTHENTICATION_ARCHITECTURE.md §4.5)
* passwordChangedAt (nullable)
* lastLoginAt
* anonymizedAt
* createdAt
* updatedAt
* deletedAt

Indexes

* email (unique **where not null**, as of ADR-022 — was previously a blanket unique constraint under the assumption every `User` has one; enforcement mechanism unchanged otherwise, see AUTHENTICATION_ARCHITECTURE.md §1.2 and ADR-014's anonymization placeholder mechanism)
* phone (**changed by ADR-022** from a plain non-unique index to a unique-where-not-null constraint — PostgreSQL permits multiple `NULL`s under a unique constraint, so Owner rows with no phone remain unconstrained while customer phones become globally unique)
* username (**new, ADR-022** — unique where not null; case-insensitive enforcement mechanism, e.g. `citext` vs. a normalized shadow column, deferred to implementation-phase schema design, not a product decision)

---

## Pending Customer Registrations (new, ADR-022 — migrated and live-verified, Phase 2.23)

Purpose

Stages an incomplete customer registration (`username` + `phone` submitted, OTP issued) before any `User` row exists. Promoted into a real `User` row only on successful completion (password set after phone verification); never itself becomes or is mistaken for a `User`. Mirrors the existing `EmailVerificationToken`/`PasswordResetToken` hash-at-rest shape, but is a distinct table (not a generalization of either) because a 6-digit OTP has an materially different entropy/attempt-limiting profile than a 256-bit opaque token — see ADR-022.

Fields (minimal, frozen by ADR-022 — no additional fields without a new decision)

* id (UUID)
* username
* phone (canonical E.164)
* codeHash (OTP hash — plaintext never persisted)
* codeExpiresAt
* incorrectAttemptCount
* verifiedAt (nullable)
* consumedAt (nullable — set when promoted into a `User`)
* createdAt
* updatedAt

Indexes

* phone, username (both looked up during Start/Resend/Verify; exact index shape deferred to migration design)
* **Unique on phone (frozen, ADR-022 Decision #18):** at most one active pending registration per canonical phone — a repeated `START` for the same phone restarts/reissues this same row (new `codeHash`/`codeExpiresAt`, `incorrectAttemptCount` reset) rather than inserting a second row; concurrency protected at the transaction boundary so two simultaneous `START`s cannot create two active rows for the same phone.

Retention / cleanup

Abandoned (expired, never-completed) rows must be cleanable. **No authoritative retention duration exists anywhere in this repository** — neither `EmailVerificationToken` nor `PasswordResetToken` rows are ever purged today, so there is no existing pattern to reuse. This duration is the one open item ADR-022 leaves for product/ops to set before a cleanup job is implemented.

---

## Customer Password Reset Tokens (new, ADR-022 Decision #16 — migrated and live-verified, Phase 2.23)

Purpose

Stages a Customer's phone-based password-recovery challenge (`START → VERIFY → COMPLETE`, `AUTHENTICATION_ARCHITECTURE.md` §15.11). Unlike `PendingCustomerRegistrations`, this always references an **existing** `User` (a Customer recovering access to an account that already exists), so it is shaped like the existing `PasswordResetToken` table (`userId` FK) rather than like a new-registration record — mirroring this repository's own existing precedent of keeping `EmailVerificationToken` and `PasswordResetToken` as separate, purpose-specific tables rather than one generalized table, applied here to a phone/OTP-shaped challenge instead of an opaque 256-bit token.

Fields (minimal, mirrors `PasswordResetToken`'s shape plus the OTP-specific fields already frozen for registration — no additional fields without a new decision)

* id (UUID)
* userId (FK → Users — resolved from the canonical phone at Start time)
* codeHash (OTP hash — plaintext never persisted)
* codeExpiresAt
* incorrectAttemptCount
* verifiedAt (nullable — set on successful `VERIFY`; does not itself change the password)
* consumedAt (nullable — set when `COMPLETE` changes the password)
* createdAt
* updatedAt

Indexes

* userId (one active challenge per user, same one-active-per-key shape as `PendingCustomerRegistrations`)

Retention / cleanup

Same open item as `PendingCustomerRegistrations` above — no authoritative retention duration exists; not invented here.

---

## User Consents

Purpose

Records a user's acceptance of a versioned policy document (Terms of Service, Privacy Policy, optional Marketing) at registration time. Persisted per ADR-014 §6 ("Consent tracking is modeled as a `UserConsent` record ... rather than inferred implicitly").

Fields

* id (UUID)
* userId
* consentType (`TermsOfService`, `PrivacyPolicy`, `Marketing`)
* termsVersion
* consentedAt
* ipAddress
* createdAt

Indexes

* userId

---

## Device Sessions

Purpose

Tracks authenticated devices; supports logout from specific devices.

Fields

* id (UUID)
* userId
* tokenFamilyId (UUID — FK to Token Families)
* refreshTokenHash
* deviceName
* deviceType (`mobile`, `web`, `tablet`, `unknown`)
* ipAddress
* userAgent
* sessionVersion (snapshot of `Users.sessionVersion` at issue)
* permissionsVersion (snapshot at issue — see AUTHORIZATION_ARCHITECTURE.md)
* lastUsedAt
* revokedAt
* revokedReason (nullable — `logout`, `reuse_detected`, `password_change`, `admin`, `expired`, `session_version_bump`)
* expiresAt
* createdAt

Indexes

* userId
* refreshTokenHash (unique)
* tokenFamilyId

---

## Token Families

Purpose

Groups refresh-token rotation chains from a single login event. Unit of replay-attack detection and family-wide revocation (AUTHENTICATION_ARCHITECTURE.md §4.4, ADR-017).

Fields

* id (UUID) — same value stored as `DeviceSessions.tokenFamilyId`
* userId
* compromisedAt (nullable — set when token reuse detected)
* revokedAt (nullable — set when family manually or automatically revoked)
* createdAt

Indexes

* userId
* compromisedAt

---

## Email Verification Tokens

Purpose

Single-use, time-limited tokens for email address verification after registration (AUTHENTICATION_ARCHITECTURE.md).

Fields

* id (UUID)
* userId
* tokenHash (unique — SHA-256 of opaque token sent to user)
* expiresAt
* consumedAt (nullable)
* createdAt

Indexes

* tokenHash (unique)
* userId
* partial (userId) WHERE consumedAt IS NULL — at most one active token per user enforced in application layer

---

## Password Reset Tokens

Purpose

Single-use, time-limited tokens for password reset flow.

Fields

* id (UUID)
* userId
* tokenHash (unique)
* expiresAt
* consumedAt (nullable)
* createdAt

Indexes

* tokenHash (unique)
* userId

---

## Password History

Purpose

Prevents reuse of recent passwords (NON_FUNCTIONAL_REQUIREMENTS.md, AUTHENTICATION_ARCHITECTURE.md).

Fields

* id (UUID)
* userId
* passwordHash
* createdAt

Indexes

* userId

Retention: last N hashes per user (`SystemConfiguration.passwordHistoryCount`, default 5).

---

## Login Attempts

Purpose

Audit trail and suspicious-login analysis; complements Redis rate limiting.

Fields

* id (UUID)
* identifier (email attempted)
* ipAddress
* success (boolean)
* failureReason (nullable)
* createdAt

Indexes

* identifier
* createdAt
* composite (identifier, createdAt)

---

## Platform Admins

Purpose

Users with platform-wide administration access; never tenant-scoped. Uses `$systemContext` per TENANCY.md.

Fields

* id (UUID)
* userId (unique)
* createdAt
* revokedAt (nullable)

Indexes

* userId (unique)

---

## Restaurants

Stores restaurant information.

Fields

* id
* organizationId
* name
* slug
* logoId
* coverImageId
* description
* cuisineType
* averageRating
* priceLevel
* status
* createdAt
* updatedAt
* deletedAt

Indexes

* organizationId
* slug
* name

Notes

* `ownerId` is removed from this table (see ADR-011). Restaurant ownership/administration is expressed through `OrganizationMember` on the parent Organization.
* `cuisineType` is a **legacy display field** retained for backward-compatible API responses. Canonical cuisine classification uses `RestaurantCuisineCategory` (many-to-many). New features must read/write taxonomy tables, not this string alone.
* `priceLevel` is the **price category** (1 = budget … 4 = fine dining). See `PRODUCT_REQUIREMENTS.md` FR-07.5.

---

## Cuisine Categories

Platform-managed taxonomy for restaurant discovery (ADR-018). Not tenant-scoped — shared reference data seeded at deploy.

Fields

* id (UUID)
* slug (unique)
* name (default English label; translatable business content deferred per DECISIONS.md Future Decisions)
* isActive
* sortOrder
* createdAt
* updatedAt

Indexes

* slug (unique)
* isActive

---

## Restaurant Cuisine Categories

Many-to-many link between `Restaurants` and `CuisineCategories`.

Fields

* id (UUID)
* restaurantId
* cuisineCategoryId
* createdAt

Indexes

* composite unique (restaurantId, cuisineCategoryId)
* cuisineCategoryId

---

## Occasion Categories

Platform-managed taxonomy (e.g., Date Night, Business Lunch, Family). Same scoping rules as `CuisineCategories`.

Fields

* id (UUID)
* slug (unique)
* name
* isActive
* sortOrder
* createdAt
* updatedAt

Indexes

* slug (unique)
* isActive

---

## Restaurant Occasion Categories

Many-to-many link between `Restaurants` and `OccasionCategories`.

Fields

* id (UUID)
* restaurantId
* occasionCategoryId
* createdAt

Indexes

* composite unique (restaurantId, occasionCategoryId)
* occasionCategoryId

---

## Restaurant Settings

Purpose

Configuration child entity of the Restaurant Aggregate (was previously undocumented as a table despite being named in DOMAIN_MODEL.md).

Fields

* id (UUID)
* restaurantId
* reservationIntervalMinutes
* maxGuestsPerReservation
* cancellationWindowMinutes
* pendingReservationTimeoutMinutes
* defaultReservationDurationMinutes (Phase 7.1 — fallback `Reservation.reservationEndTime` duration when the client omits it)
* autoApproval (boolean)
* timezone
* defaultCurrency
* reservationReminderMinutesBefore (Phase 7.6 — ADR-019 Operational Signals; int, 1-10080, default 60; minutes before `reservationStartTime` the `ReservationReminderDue` BullMQ job fires)
* lateArrivalGraceMinutes (Phase 7.6 — ADR-019 Operational Signals; int, 1-1440, default 15; minutes after `reservationStartTime` the `GuestLateArrivalNotified` BullMQ job fires)
* createdAt
* updatedAt

Indexes

* restaurantId (unique — one settings row per restaurant)

---

## Working Hours

Purpose

Weekly opening/closing schedule. Long-term design is a child entity of Restaurant (default) and overridable per Branch; **Phase 4.3 implements the Restaurant-level default only** (explicit architecture decision, 2026-07-16, DOMAIN_MODEL.md is authoritative for aggregate ownership in this phase — `WorkingHours` is a Restaurant Aggregate child entity only, see DOMAIN_MODEL.md "Restaurant Aggregate"). Branch-level override (`branchId`, composite override lookup) is deferred to Phase 5 when the Branch aggregate/module is implemented, and will be added as a separate, additive migration at that time — not introduced now.

Fields (Phase 4.3 — Restaurant-level only)

* id (UUID)
* restaurantId (required — every row belongs to exactly one Restaurant)
* dayOfWeek (integer, 0=Sunday..6=Saturday; one row per day per restaurant, missing day = closed that day)
* openingTime (`HH:mm`, 24-hour)
* closingTime (`HH:mm`, 24-hour; `closingTime <= openingTime` is valid and represents hours crossing midnight)
* breakStartTime (`HH:mm`, nullable)
* breakEndTime (`HH:mm`, nullable; both break fields null or both present, `breakStartTime < breakEndTime`)
* createdAt
* updatedAt

Indexes

* restaurantId
* unique composite (restaurantId, dayOfWeek)

**Resolved in Phase 5.2**: branch-level override was delivered as a separate table, `BranchWorkingHours` (see "Branch Working Hours" below), not as a nullable `branchId` column added to this table - each aggregate owns its own child entity, avoiding the dual-parent design this section originally anticipated.

---

## Restaurant Gallery

Purpose

Stores ordered image references for a restaurant's public gallery.

Fields

* id (UUID)
* restaurantId
* fileId
* caption
* sortOrder
* createdAt
* updatedAt

Indexes

* restaurantId

---

## Restaurant Social Links

Purpose

Stores a restaurant's external social/web links.

Fields

* id (UUID)
* restaurantId
* platform (`Instagram`, `Facebook`, `Website`, `TikTok`, ...)
* url
* createdAt
* updatedAt

Indexes

* restaurantId

---

## Branches

Stores restaurant branches.

Relationships

Restaurant → Many Branches

Fields

* id
* restaurantId
* city
* district
* address
* latitude
* longitude
* countryCode
* currency
* openingHours
* timezone
* phone
* createdAt
* updatedAt
* deletedAt

Indexes

* restaurantId
* city
* countryCode
* composite (latitude, longitude) — added Phase 5.3 as a plain B-tree index; supports bounding-box and distance queries for nearby-restaurant search (ADR-018); consider upgrading to `GiST` on `point(longitude, latitude)` when query volume warrants (Phase 15+)

Notes

* `countryCode` and `currency` are owned at this level, not the Restaurant level (see DOMAIN_MODEL.md Money/Currency Ownership). If `currency` is null, the application falls back to `Restaurant Settings.defaultCurrency`.
* Geo coordinates are authoritative for **nearby restaurant** queries at branch granularity (a restaurant with multiple branches appears once per qualifying branch).
* **Phase 5.1 (Branch CRUD) scope**: `id`, `restaurantId`, `city`, `district`, `address`, `countryCode`, `currency`, `timezone`, `phone` are exposed and mutable via `POST`/`GET`/`PATCH`/`DELETE /api/v1/restaurants/:restaurantId/branches[/:branchId]`. `Branch` carries no direct `organizationId` column and is deliberately not registered in the tenant-scoping Prisma extension's `DIRECT_TENANT_OWNED_MODELS`; tenant isolation is enforced by resolving the parent Restaurant first (see TENANCY.md and TASKS.md's "Phase 5.1" report).
* **Phase 5.3 (Geo Coordinates for Nearby Search, ADR-018) scope**: `latitude`/`longitude` are now also exposed and mutable via the same `POST`/`PATCH` routes above - both must be set together or both omitted (`InvalidBranchCoordinatesException`, 400), and range-validated (-90..90 / -180..180) at both the DTO and domain layers. The actual bounding-box/nearby-search query that reads these columns is out of this scope, deferred to a future Discovery module (TASKS.md Phase 15.5) per ADR-018's own attribution - the columns and index exist and are populated, but nothing queries them yet. See TASKS.md's "Phase 5.3" report.
* **Phase 5.2 (Working Schedule) resolution**: the branch-level working-hours override was delivered as a separate table, `BranchWorkingHours` (see below), not via this row's own `openingHours` Json column. `openingHours` remains `NULL`/unused by any code - it is pre-existing technical debt from the Phase 2.1 foundation migration (flagged, not removed, since no phase owns cleaning it up yet), structurally superseded by `BranchWorkingHours` for any future consumer.

---

## Branch Working Hours

Purpose

Branch-level weekly opening/closing schedule override (Phase 5.2), resolving the branch-level override the "Working Hours" section above deferred to Phase 5. A separate table from `WorkingHours` (Restaurant-level, Phase 4.3) - each aggregate owns its own child entity, not a nullable `branchId` added to the Restaurant-level table. Structurally identical to `WorkingHours`, scoped to `branchId` instead of `restaurantId`.

Fields

* id (UUID)
* branchId (required — every row belongs to exactly one Branch)
* dayOfWeek (integer, 0=Sunday..6=Saturday; one row per day per branch, missing day = no override for that branch)
* openingTime (`HH:mm`, 24-hour)
* closingTime (`HH:mm`, 24-hour; `closingTime <= openingTime` is valid and represents hours crossing midnight)
* breakStartTime (`HH:mm`, nullable)
* breakEndTime (`HH:mm`, nullable; both break fields null or both present, `breakStartTime < breakEndTime`)
* createdAt
* updatedAt

Indexes

* branchId
* unique composite (branchId, dayOfWeek)

Notes

* Tenant-owned transitively via `branchId -> Branch.restaurantId -> Restaurant.organizationId` (two hops), not directly - not registered in the tenant-scoping Prisma extension's `DIRECT_TENANT_OWNED_MODELS`, same pattern as `WorkingHours`/`RestaurantSettings`. Every use case resolves the parent Restaurant, then the parent Branch, via their already-tenant-scoped repositories first (see TASKS.md's "Phase 5.2" report).
* No precedence/fallback logic exists yet between a Branch's override here and its Restaurant's default in `WorkingHours` - out of Phase 5.2's CRUD-only scope; a future consumer (most likely the Reservation Engine, Phase 7) will need to define that resolution.

---

## Floor Plans

Purpose

A Branch may define more than one floor layout over time (e.g., seasonal outdoor seating vs. standard indoor layout). Only one `FloorPlan` per branch is `active`; `Table` position fields are interpreted relative to the currently active plan. Justification for a dedicated table (rather than fields on Table alone): without it, changing a branch's layout would require mutating or duplicating every Table row, destroying the historical position data for the previous layout and complicating the "one active layout at a time" invariant.

Fields

* id (UUID)
* branchId
* name
* isActive (boolean)
* createdAt
* updatedAt

Indexes

* branchId
* composite partial unique (branchId) WHERE isActive = true — guarantees at most one active floor plan per branch

Notes

* **Phase 6.1 architecture decision:** every Table belongs to exactly one FloorPlan (`Table.floorPlanId` is required, never nullable - see "Restaurant Tables" below). A Branch with only one physical floor still gets one `FloorPlan` row (e.g., named "Main Floor"); there is no "tableless"/"floor-plan-less" state. A FloorPlan is the owner of its table layout - retrieving all Tables belonging to one FloorPlan is a required read capability (exact endpoint shape decided at implementation time, not fixed here).
* **Activation invariants** (Aggregate Invariants, not optional validation - see DOMAIN_MODEL.md's Branch Aggregate Notes for full detail): the first FloorPlan created for a Branch becomes `isActive = true` automatically, with no manual activation step; activating a different FloorPlan atomically deactivates the previously active one in the same operation, so the `composite partial unique (branchId) WHERE isActive = true` index above is never violated even transiently; a FloorPlan cannot be deleted while any Table still references it via `floorPlanId` (the delete must be rejected); a Branch's last remaining FloorPlan cannot be deleted (a Branch always owns at least one).
* **Cascade:** soft-deleting a Branch cascades to soft-deleting its FloorPlans, alongside its Tables (see "Restaurant Tables" below and DOMAIN_MODEL.md's Branch Aggregate Notes) - both are child entities of the Branch Aggregate, so this is aggregate consistency, not a new feature. **This cascade executes inside one database transaction; partial completion (e.g., Branch deleted but Tables/FloorPlans not) is forbidden.**

---

## Restaurant Tables

Each branch owns multiple tables.

Fields

* id
* branchId
* floorPlanId (required — every Table belongs to exactly one FloorPlan; never nullable, per Phase 6.1's architecture decision)
* tableNumber
* capacity
* floor
* positionX
* positionY
* width
* height
* rotation
* shape (`Rectangle`, `Round` only — Phase 6.1 architecture decision; see Notes)
* layer
* indoor
* vip
* smoking
* status (`Available`, `Occupied`, `Cleaning`, `Disabled`, `Reserved`, `Merged` — Status Management + Phase 7.2 + **ADR-026 Merge/Split freeze**; see Notes)
* mergeGroupId (nullable)
* isMergePrimary (boolean, default false — **ADR-026**)
* createdAt
* updatedAt
* deletedAt

Indexes

* branchId
* floorPlanId
* status
* mergeGroupId
* composite unique (branchId, tableNumber) — table numbers are unique within a branch
* partial unique (mergeGroupId) WHERE isMergePrimary = true AND mergeGroupId IS NOT NULL — exactly one primary per active group (**ADR-026**, when enforceable)

Notes

* **Cascade:** soft-deleting a Branch cascades to soft-deleting its Tables (and its FloorPlans - see "Floor Plans" above), but never its historical Reservations, which are immutable per the Soft Delete Policy above (DOMAIN_MODEL.md's Branch Aggregate Notes, "Branch deletion"). **Executes inside one database transaction; partial completion is forbidden** - the system must never reach a state where the Branch is soft-deleted but its Tables and/or FloorPlans are not.
* **Deletion guard:** a FloorPlan cannot be deleted while any (non-soft-deleted) Table still references it via `floorPlanId`; the operation must be rejected, not silently reassigned or orphaned (Aggregate Invariant, see "Floor Plans" above and DOMAIN_MODEL.md).
* **`status` (Phase 6.1 decision, superseded by the Status Management architecture decision; `Merged` added by ADR-026):** `Create Table` still always produces `Available`. The `TableStatus` enum also defines `Occupied`, `Cleaning`, and `Disabled` (Status Management architecture decision) - transitioned exclusively through the single dedicated Domain Action `POST /tables/{tableId}/status` (see API_GUIDELINES.md); `Update Table` (`PATCH /tables/:tableId`) never modifies `status`. Allowed manual transitions are restricted to `Available ↔ Occupied`, `Available ↔ Cleaning`, and `Available ↔ Disabled` only - every other combination is rejected. `Reserved` (**Phase 7.2**) is set/cleared exclusively by `Table.reserve()` / `Table.release()`. **`Merged` (ADR-026)** applies only to **secondary** members of an active merge group and is set/cleared exclusively by Merge/Split — never via `POST /tables/{tableId}/status`. Status transitions publish `TableStatusChanged` for manual transitions only (Phase 8).
* **`mergeGroupId` / `isMergePrimary` (ADR-026):** `mergeGroupId` remains a plain nullable UUID (not an FK — no MergeGroup table). Invariant: `mergeGroupId IS NULL ⇒ isMergePrimary = false`. For every non-null `mergeGroupId`, exactly one row has `isMergePrimary = true` (the reservable primary). Permanent `capacity` is never overwritten for merge; effective capacity of the primary while merged is the **sum** of member capacities (derived at read/search time).
* **`shape` (Phase 6.1 architecture decision):** `TableShape` is presentation metadata only - it describes how a table renders on the floor plan and does not participate in reservation rules, capacity, or merge/split behavior. Its initial value set is intentionally minimal: `Rectangle` and `Round` only. A square table is represented as `Rectangle` with `width == height`; there is no separate `Square` value. `Oval`/`Triangle`/`Hexagon`/`Custom`/any other value are not defined and must not be inferred - a future product requirement may extend the enum, but only through an explicit architectural decision.

---

## Reservations

Fields

* id
* userId (nullable if a ReservationGuest is used instead)
* reservationGuestId (nullable if a User is used instead)
* restaurantId
* branchId
* tableId
* reservationDate
* reservationStartTime
* reservationEndTime (always persisted as a concrete value — never null; see Notes below)
* guests
* status
* source
* notes
* createdBy (nullable as of Phase 7.5, migration `20260724141815_phase_7_5_reservation_waitlist` — `null` means an automatic/System Waitlist promotion created the row; every other source (Online/Phone/WalkIn/Staff, manual Waitlist promotion) still always sets a real actor id)
* approvedBy
* approvedAt
* cancelledAt
* completedAt
* noShowAt
* lateArrivalNotifiedAt (nullable — set when late-arrival notification dispatched per ADR-019)
* tableReadyNotifiedAt (nullable — set when table-ready notification dispatched per ADR-019)
* rescheduledFromReservationId (nullable — points to the prior reservation record if this row resulted from a reschedule, if reschedules are modeled as new rows; see Migration Rules note)

Notes

* `source` enum includes at minimum: `Online`, `Phone`, `WalkIn`, `Staff`, `WaitlistConversion` (when a waitlist entry is promoted to a reservation).
* `reservationEndTime` (Phase 7.1 architecture decision, 2026-07-20 — documentation clarification only, no schema change): always persisted, never left null. It may originate from client input (validated: must be later than `reservationStartTime`, and must satisfy any configured Restaurant reservation-duration constraints) or from backend derivation (the Restaurant's `Default Reservation Duration` setting, applied when the client omits the field). Persistence rules, and every downstream reader of this column (the exclusion constraint above, `ReservationHistory`, availability search), are identical regardless of which path produced the value — the column carries no marker of its origin.

Indexes

* reservationDate
* tableId
* branchId
* status
* composite (branchId, reservationDate, status) — the primary availability-search query filters by branch and date and excludes cancelled/expired reservations; this composite index directly serves that query without a full scan
* composite (tableId, reservationDate, reservationStartTime) — supports the conflict-check query executed inside the advisory-locked transaction (ADR-013) that verifies no overlapping reservation exists for a specific table before insert
* exclusion constraint EXCLUDE USING gist (tableId WITH =, tstzrange(reservationStartTime, reservationEndTime) WITH &&) WHERE status NOT IN ('Cancelled', 'Expired', 'Rejected', 'Pending') — the database-level safety net from ADR-013; guards only `Approved`/`Completed`/`NoShow` rows, matching "a table cannot have overlapping **confirmed** reservations" below — `Pending` is deliberately excluded so two overlapping Pending reservations for the same table may coexist (per the business rule immediately below), resolved at approval time, not blocked at creation time; requires the `btree_gist` extension
* CHECK constraint `reservations_party_xor_chk` (Phase 7.4, migration `20260723184453_phase_7_4_reservation_guests`): `(userId IS NOT NULL AND reservationGuestId IS NULL) OR (userId IS NULL AND reservationGuestId IS NOT NULL)` — the reservation-party invariant enforced at the database layer in addition to the domain layer (`Reservation`'s own `validateParty`)

Notes

* Rescheduling a reservation updates the existing row in place (date/time/guests) rather than creating a new row, so a single `Reservation.id` remains stable for a customer across a reschedule; the full before/after values are captured in `Reservation History` instead. `rescheduledFromReservationId` is therefore reserved for a possible future "reschedule as a new booking" flow and is nullable/unused until such a flow is introduced — not required for the standard in-place reschedule described in DOMAIN_MODEL.md.
* `reservationGuestId` gained its real foreign key to `ReservationGuest.id` (`ON DELETE RESTRICT`) in Phase 7.4's migration — previously (Phase 7.1–7.3) it was a plain, FK-less nullable UUID column, since `ReservationGuest` did not exist as a table yet.

---

## Reservation Guests

Purpose

Represents the person a reservation is for when no registered User account exists (phone reservations, walk-ins). Personal data here is subject to the same anonymization rules as the User table (see ADR-014). Dependent entity of the Reservation Aggregate (Phase 7.4 decision #4), not a standalone aggregate — persisted via its own repository (mirroring `ReservationHistory`'s own precedent), always inside the same transaction as the `Reservation` row that references it (Phase 7.4 binding clarification #2).

Fields

* id (UUID)
* fullName
* phone
* email (nullable)
* anonymizedAt (nullable) — schema is anonymization-*compatible*; no erasure subsystem is implemented as of Phase 7.4 (decision #13)
* createdAt
* updatedAt

Indexes

* phone

**Implemented:** Phase 7.4 (Phone & Walk-In Reservations, architecture frozen 2026-07-23), migration `20260723184453_phase_7_4_reservation_guests`. Not implemented by Phase 7.1–7.3, which only ever produced `source = Online` reservations.

---

## Reservation History

Stores every reservation state transition and modification. Introduced by **Phase 7.3 — Reservation Lifecycle** (architecture frozen 2026-07-23, implemented and live-verified 2026-07-23; not created by Phase 7.1/7.2, which retain their existing `AuditingEventPublisher`-only auditing unchanged). Rows are created by Cancel, Reschedule, Complete, NoShow, and Expire — the five transitions Phase 7.3 introduces; Approve/Reject are not retroactively extended to write here. Migration: `20260723143714_phase_7_3_reservation_lifecycle`.

Fields

* id (UUID)
* reservationId
* oldStatus
* newStatus
* oldReservationDate (nullable — populated on reschedule)
* oldReservationStartTime (nullable — populated on reschedule)
* newReservationDate (nullable — populated on reschedule)
* newReservationStartTime (nullable — populated on reschedule)
* oldTableId (nullable UUID — populated only on a table-changing reschedule; Phase 7.3 architecture decision, 2026-07-23, since Reschedule may change the assigned Table within the same Branch — see DOMAIN_MODEL.md's Reservation business rules and ADR-023)
* newTableId (nullable UUID — populated only on a table-changing reschedule, same decision)
* withinCancellationWindow (boolean, nullable — populated on cancel/reschedule)
* changedBy (nullable — the acting `User`/`Employee` id; `null` for the System-driven Expire)
* changedAt
* reason (nullable — customer/staff-supplied context, e.g. a Cancel reason; never required by any product requirement)

Indexes

* reservationId

---

## Reservation Waitlist Entries

Guests who cannot be seated immediately join a branch-scoped, date-scoped waitlist (ADR-019). Distinct from `Reservations` — no table assignment until promoted (`WaitlistPromotionService`).

**Implemented:** Phase 7.5 (Reservation Waitlist, architecture frozen 2026-07-24, implemented and live-verified 2026-07-24), migration `20260724141815_phase_7_5_reservation_waitlist`, corrected by the forward migration `20260724143130_phase_7_5_1_waitlist_remove_organization_id` (see "No `organizationId`" note below).

Fields

* id (UUID)
* restaurantId
* branchId
* userId (nullable — registered customer)
* reservationGuestId (nullable — phone/walk-in guest; exactly one of `userId` or `reservationGuestId` required)
* partySize
* preferredDate (required — the queue service date; not nullable, unlike the original pre-implementation draft of this table)
* preferredTimeFrom (required — Phase 7.5 final decision, 2026-07-24: the **authoritative** requested Reservation start time-of-day on promotion, interpreted in the target `Branch.timezone`; superseded the original "soft preference" framing)
* preferredTimeTo (nullable — remains optional and non-authoritative, filtering metadata only, never used to construct a Reservation)
* status (`Waiting`, `Notified`, `Converted`, `Expired`, `Cancelled`)
* position (integer — FIFO queue order within `(branchId, preferredDate)`; immutable once assigned, gaps allowed)
* convertedReservationId (nullable, unique — set when promoted to `Reservations`; real FK to `Reservations.id`, `ON DELETE SET NULL`)
* notifiedAt (nullable — reserved for Phase 7.6; no Phase 7.5 code path sets it)
* expiresAt (end of `preferredDate` 23:59:59.999 in `Branch.timezone`, converted to UTC — never affected by `preferredTimeFrom`/`preferredTimeTo`)
* notes (nullable)
* createdBy (the joining Customer's `userId` or the joining Employee's `employeeId` — always a real actor id, never null; System never Joins)
* createdAt
* updatedAt
* deletedAt

Indexes

* branchId
* status
* composite (branchId, preferredDate, status)
* composite (branchId, status, position)
* userId
* reservationGuestId

Constraints

* CHECK `reservation_waitlist_entries_party_xor_chk`: (`userId` IS NOT NULL AND `reservationGuestId` IS NULL) OR (`userId` IS NULL AND `reservationGuestId` IS NOT NULL) — mirrors `reservations_party_xor_chk`, raw SQL only (not expressible in `schema.prisma`)
* Partial unique index `reservation_waitlist_entries_active_position_key` ON (`branchId`, `preferredDate`, `position`) WHERE `status` IN (`Waiting`, `Notified`) AND `deletedAt` IS NULL — at most one active entry may hold a given position within a queue scope; raw SQL only, same technique as `floor_plans_branch_id_active_key` (Phase 6.1). Concurrent Joins are additionally serialized by a transaction-scoped advisory lock keyed by `(branchId, preferredDate)` (the same `pg_advisory_xact_lock` technique ADR-013 established, generalized to a new lock namespace) before position is computed — this index is the database-level safety net, not the primary mechanism.

No `organizationId` (tenancy correction, 2026-07-24): the originally-drafted shape of this table (before implementation) specified a direct `organizationId` column. That was found, during implementation, to be structurally incompatible with Customer-facing Join — a Customer actor has no bound `TenantContext.organizationId`, and `Restaurant` (the only path to discover one) is a `DIRECT_TENANT_OWNED_MODEL`, fail-closed with no context bound. A forward corrective migration dropped the column before any row existed. Tenant ownership is resolved transitively (`branchId -> Branch.restaurantId -> Restaurant.organizationId`), exactly like `Reservation` itself already does; this table remains unregistered in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`. See ADR-019's Phase 7.5 implementation decision note (`DECISIONS.md`) for the full account.

---

## Employees

Fields

* id
* restaurantId
* roleId (FK → Roles — the employee's operational **Employee Role**; not a separate `EmployeeRole` table)
* userId (nullable — linked when employee accepts invite and authenticates)
* permissionsVersion (incremented on role/override/branch change)
* firstName
* lastName
* email
* phone
* status
* createdAt
* updatedAt
* deletedAt

Indexes

* restaurantId
* email

Notes

* `branchId` is removed as a direct column (see ADR discussion in DOMAIN_MODEL.md Employee Aggregate) and replaced by the `Employee Branch Assignments` join table below, since an employee may work across zero (restaurant-wide), one, or several branches.

---

## Employee Branch Assignments

Purpose

Join entity scoping an Employee's operational access to specific Branches. An Employee with no rows here is scoped to the whole Restaurant.

Fields

* id (UUID)
* employeeId
* branchId
* assignedAt
* createdAt

Indexes

* employeeId
* branchId
* composite unique (employeeId, branchId)

---

## Roles

Purpose

Operational restaurant roles for Employee RBAC. Organization administrative roles (`Owner`, `Admin`, …) are stored on `OrganizationMember.role`, not in this table — see AUTHENTICATION_ARCHITECTURE.md §6.

Fields

* id (UUID)
* name
* slug (unique)
* description
* scope (`Platform`, `Restaurant`)
* createdAt
* updatedAt

Examples (seed data)

* Manager
* Receptionist
* Cashier

---

## Permissions

Purpose

Granular operational capabilities, namespaced as `<resource>:<action>`.

Fields

* id (UUID)
* slug (unique)
* description
* createdAt

Examples (seed data)

* `reservations:create`
* `reservations:approve`
* `tables:manage`
* `employees:manage`

---

## Role Permissions

Purpose

Many-to-many junction between Roles and Permissions, plus per-employee individual overrides (grants and revocations) referenced in DOMAIN_MODEL.md's Employee Permission Inheritance rule and AUTHORIZATION_ARCHITECTURE.md.

**There is no `UserPermission` table.** User-level permission overrides for employees are stored here with `employeeId` set. Organization administrative capabilities use `OrganizationMember.role` enum. Future direct user grants (ABAC, temporary permissions) use the planned `PermissionAssignment` table (AUTHORIZATION_ARCHITECTURE.md §23).

Fields

* id (UUID)
* roleId (nullable — null when this row represents an individual override rather than a role-level grant)
* employeeId (nullable — null when this row represents a role-level grant rather than an individual override)
* permissionId
* type (`RoleGrant`, `IndividualGrant`, `IndividualRevocation`)
* createdAt

Indexes

* roleId
* employeeId
* composite unique (roleId, permissionId) WHERE type = 'RoleGrant'
* composite unique (employeeId, permissionId) WHERE type IN ('IndividualGrant', 'IndividualRevocation')

---

## Permission Assignments (Future — Phase 3+)

Purpose

Temporary, time-bound, or ABAC permission grants not covered by `RolePermissions`. Documented now for schema evolution; **not migrated in Phase 2.1**.

Fields

* id (UUID)
* principalType (`User`, `Employee`)
* principalId
* permissionId
* validFrom
* validUntil
* grantedBy
* reason
* createdAt

Indexes

* principalType, principalId
* validUntil

---

## Menus

Restaurant menus.

Fields

* id (UUID)
* restaurantId
* branchId (nullable — null means the menu applies to all branches of the restaurant; set when a specific branch has a distinct menu)
* name
* isActive
* createdAt
* updatedAt
* deletedAt

Indexes

* restaurantId
* branchId

---

## Menu Categories

Fields

* id (UUID)
* menuId
* name
* sortOrder
* createdAt
* updatedAt

Indexes

* menuId

---

## Menu Items

Fields

* id (UUID)
* menuCategoryId
* name
* description
* price
* currency
* imageId
* available
* createdAt
* updatedAt

Indexes

* menuCategoryId

Notes

* `currency` on a Menu Item follows the owning Branch's currency (see Branches table); denormalized onto the row at write time so historical prices remain correctly denominated even if a branch's currency setting changes later.

---

## Reviews

Fields

* id (UUID)
* userId
* restaurantId
* reservationId
* rating
* comment
* createdAt
* updatedAt
* deletedAt

Indexes

* restaurantId
* userId
* composite unique (reservationId) — enforces "one reservation may produce only one review"

---

## Review Images

Stores uploaded review photos.

Fields

* id (UUID)
* reviewId
* fileId
* sortOrder
* createdAt

Indexes

* reviewId

---

## Restaurant Replies

Purpose

A restaurant's single reply to a review (DOMAIN_MODEL.md: "Restaurant owners may reply once to a review").

Fields

* id (UUID)
* reviewId
* repliedBy (employeeId)
* comment
* createdAt
* updatedAt

Indexes

* composite unique (reviewId) — enforces at most one reply per review

---

## Favorites

Stores customer favorite restaurants.

Fields

* id (UUID)
* userId
* restaurantId
* createdAt

Indexes

* composite unique (userId, restaurantId)

---

## Notifications

**Phase 9 pre-implementation architecture decisions (frozen 2026-07-25, see `TASKS.md`'s "Phase 9 — Notification System: Pre-implementation architecture decisions").** Durable record — REST/the database is the source of truth; Phase 8 WebSocket delivery is only a best-effort realtime presentation hint (decision item 1), never a substitute for this table. `userId`-owned only in v1 (decision item 2 — no `Employee`/`OrganizationMember`/`ReservationGuest` recipient exists yet). No direct `organizationId` — deliberately, to avoid the Phase 7.5 `ReservationWaitlistEntry.organizationId` mistake; a Customer's notifications span every organization they've ever booked with (decision item 13). Two independent state tracks on one row: `read`/`readAt` (in-app) and `pushStatus`/`pushSentAt`/`pushFailedAt` (push), deliberately decoupled (decision item 5) — reading never depends on push outcome. **Implemented 2026-07-25** — migration `20260725190000_phase_9_notifications`, additive only.

Fields

* id (UUID)
* userId (FK → Users, required)
* type (source domain eventType, e.g. `ReservationApproved` — see `EVENTS.md`'s Phase 9 event→notification allow-list)
* templateId (nullable, FK → NotificationTemplates — traceability only; `title`/`body` below are already resolved/snapshotted at creation time and are never re-read from the template for rendering)
* title (resolved, snapshotted at creation in the recipient's language)
* body (resolved, snapshotted at creation)
* data (nullable JSON — minimal deep-link payload only, e.g. `{ reservationId }`/`{ entryId }`; never `ReservationGuest` contact fields or internal audit identifiers — see the PII policy below)
* read (boolean, default false)
* readAt (nullable — set atomically with `read` transitioning to true)
* pushStatus (`NotAttempted` [default] | `Queued` | `Accepted` | `Failed` — no `Delivered` value: OneSignal's synchronous Send API only proves provider acceptance, never on-device delivery; see `EVENTS.md`)
* pushSentAt (nullable — the moment the provider *accepted* the request, not device delivery)
* pushFailedAt (nullable)
* pushFailureReason (nullable — coarse classification only, e.g. `no_subscription`/`rate_limited`/`provider_error`; never a raw provider error dump)
* pushIdempotencyKey (nullable UUID — generated once per logical notification, reused across BullMQ retries, never regenerated per attempt)
* pushProviderMessageId (nullable — OneSignal's returned notification id, once accepted)
* createdAt
* updatedAt

No `deletedAt` — deletion/retention is explicitly undecided/deferred in the Phase 9 freeze (no current product requirement specifies it), additive later without migration risk. No `retryCount` column — BullMQ's own per-job `attempts`/backoff configuration is the retry-count authority (mirrors `ReminderQueue`/`LateArrivalQueue`, neither of which duplicates retry count on their own rows). **Explicitly not built:** a `PushSubscription`/device-registration table (OneSignal's own `external_id`-keyed Subscription model is the subscription source of truth — Tavola never persists device/subscription identifiers server-side in v1) and a `NotificationDeliveryAttempt` table (the fields above are sufficient for v1's observability needs; per-attempt history, if ever needed, lives in BullMQ's own job log).

Indexes

* userId
* composite (userId, read) — serves the common "unread notifications for this user" query

---

## Notification Templates

Purpose

Provides locale-aware notification content, resolved by `NotificationDispatcher` (see DOMAIN_MODEL.md). Justification: without a template entity, translated notification copy would have to live in application code, making it impossible for non-developers to manage content and impossible to add a language without a deployment.

**Phase 9 freeze (2026-07-25):** platform-global only — no restaurant-specific override, no versioning (no current requirement demands either). Unique `(eventType, language, channel)` already supports Push and In-App carrying separate content for the same event/language without any schema change. `SMS` remains present in `channel` purely as documented schema foresight — not implemented against, no SMS template content or delivery code is in Phase 9 v1 scope.

Fields

* id (UUID)
* eventType (e.g., `ReservationApproved`, `ReservationCancelled`)
* language
* channel (`Push`, `InApp`, `SMS` — `SMS` reserved/unimplemented; `Email` permanently removed from scope, 2026-07-25 product decision)
* title (push heading / in-app title)
* body
* isDefault (boolean — marks the fallback used when no translation exists for the recipient's language)
* createdAt
* updatedAt

Indexes

* composite unique (eventType, language, channel)
* composite (eventType, channel) WHERE isDefault = true

---

## Offers

Restaurant promotions.

Fields

* id (UUID)
* restaurantId
* title
* description
* discountType (`Percentage`, `FixedAmount`)
* discountValue
* startsAt
* endsAt
* status (`Draft`, `Published`, `Expired`)
* createdAt
* updatedAt
* deletedAt

Indexes

* restaurantId
* composite (restaurantId, status)

---

## Subscriptions

Stores active subscription plans.

Fields

* id (UUID)
* organizationId
* subscriptionPlanId
* status (`Active`, `PastDue`, `Cancelled`, `Expired`)
* startedAt
* renewsAt
* cancelledAt
* createdAt
* updatedAt

Indexes

* organizationId (unique — one active subscription per organization)

Notes

* `organizationId`, not `restaurantId` — see ADR-011. All plan limits apply to the Organization's aggregate usage across its restaurants.

---

## Subscription Plans

* Free
* Basic
* Professional
* Enterprise

Fields

* id (UUID)
* name
* maxRestaurants
* maxBranchesPerRestaurant
* maxEmployeesPerRestaurant
* maxMonthlyReservations
* priceAmount
* priceCurrency
* billingInterval (`Monthly`, `Yearly`)

Indexes

* name (unique)

---

## Subscription Usage

Purpose

Tracks an Organization's current usage against its plan limits (DOMAIN_MODEL.md: recalculated incrementally from domain events, not a live COUNT(*)).

Fields

* id (UUID)
* organizationId
* restaurantCount
* branchCount
* employeeCount
* monthlyReservationCount
* usagePeriodStart
* updatedAt

Indexes

* organizationId (unique)

---

## Payments

Payment records.

Provider-independent.

Fields

* id (UUID)
* organizationId
* subscriptionId (nullable — null for a non-subscription billable operation)
* amount
* currency
* status (`Pending`, `Succeeded`, `Failed`, `Refunded`)
* provider
* providerReference
* createdAt
* updatedAt

Indexes

* organizationId
* subscriptionId
* providerReference

---

## Payment Transactions

Tracks payment lifecycle.

Fields

* id (UUID)
* paymentId
* status
* rawProviderPayload (jsonb — stored for audit/dispute resolution; never logged in plaintext application logs per CODING_STANDARDS.md)
* occurredAt
* createdAt

Indexes

* paymentId

---

## Invoices

Billing documents generated from successful payments or subscription renewals (ADR-021). Stored metadata in PostgreSQL; PDF binary in MinIO via `Files`.

Fields

* id (UUID)
* organizationId
* paymentId (nullable — null for pro-forma or manual invoices not yet linked)
* invoiceNumber (unique per organization — human-readable, e.g. `INV-2026-00042`)
* status (`Draft`, `Issued`, `Paid`, `Void`, `Overdue`)
* subtotalAmount
* taxAmount
* totalAmount
* currency
* lineItems (jsonb — structured line items for display/PDF)
* issuedAt (nullable)
* dueAt (nullable)
* paidAt (nullable)
* pdfFileId (nullable — FK → `Files`)
* providerInvoiceId (nullable — external billing system reference)
* createdAt
* updatedAt

Indexes

* organizationId
* composite unique (organizationId, invoiceNumber)
* paymentId
* status

---

## Conversations

Customer–restaurant messaging threads (ADR-020). Tenant-scoped via `organizationId`.

Fields

* id (UUID)
* organizationId
* restaurantId
* branchId (nullable)
* reservationId (nullable — when chat is about a specific booking)
* subject (nullable)
* status (`Open`, `Closed`, `Archived`)
* lastMessageAt
* createdAt
* updatedAt
* deletedAt

Indexes

* organizationId
* restaurantId
* reservationId
* composite (organizationId, lastMessageAt)
* status

---

## Conversation Participants

Links users and/or employees to a conversation. A customer participant is always a `User`; staff participants are `Employee` records.

Fields

* id (UUID)
* conversationId
* userId (nullable)
* employeeId (nullable)
* role (`Customer`, `Staff`, `System`)
* lastReadAt (nullable)
* joinedAt
* leftAt (nullable)

Indexes

* conversationId
* userId
* employeeId
* composite unique (conversationId, userId) WHERE userId IS NOT NULL
* composite unique (conversationId, employeeId) WHERE employeeId IS NOT NULL

Constraints

* CHECK: (`userId` IS NOT NULL AND `employeeId` IS NULL) OR (`userId` IS NULL AND `employeeId` IS NOT NULL) OR (`role` = 'System')

---

## Messages

Individual messages within a conversation.

Fields

* id (UUID)
* conversationId
* senderUserId (nullable)
* senderEmployeeId (nullable)
* body (text — max length enforced at application layer)
* messageType (`Text`, `System`, `Attachment`)
* attachmentFileId (nullable — FK → `Files`)
* createdAt
* updatedAt
* deletedAt

Indexes

* conversationId
* composite (conversationId, createdAt)

Constraints

* CHECK: exactly one of `senderUserId` or `senderEmployeeId` is non-null for `messageType` = `Text`

---

## Files

Stores uploaded file metadata.

Actual files are stored in MinIO.

Fields

* id (UUID)
* ownerId
* ownerType (`User`, `Restaurant`, `Review`, `Menu`)
* bucket
* objectKey
* mimeType
* sizeBytes
* accessPolicy (`Public`, `Private`)
* createdAt
* deletedAt

Indexes

* composite (ownerType, ownerId)

---

## Audit Logs

Stores all important actions. Immutable — never updated or deleted (see Audit Policy).

Examples

Login

Reservation Approval

Employee Creation

Restaurant Update

Fields

* id (UUID)
* actorId
* actorType (`User`, `Employee`, `System`)
* action
* targetType
* targetId
* organizationId (nullable — set for tenant-scoped actions, null for platform-administration actions)
* correlationId
* ipAddress
* occurredAt

Indexes

* composite (targetType, targetId)
* organizationId
* occurredAt

---

## System Configuration

Purpose

Stores platform-wide, environment-adjustable configuration values referenced throughout this document and DOMAIN_MODEL.md (e.g., `anonymizationGracePeriodDays`, `noShowThreshold`), satisfying the "no hardcoded values" rule without requiring a deployment to change a tunable business parameter.

Authentication-related keys (see AUTHENTICATION_ARCHITECTURE.md §7.12): `emailVerificationTokenTtlHours`, `passwordResetTokenTtlHours`, `passwordHistoryCount`, `maxFailedLoginAttempts`, `accountLockDurationMinutes`, `maxActiveSessionsPerUser`, `refreshTokenTtlDays`.

Fields

* id (UUID)
* key (unique)
* value (jsonb)
* description
* updatedBy
* updatedAt

Indexes

* key (unique)

---

## Feature Flags

Purpose

Storage for feature-flag state, enabling progressive rollout of features (e.g., a new Offers capability) without a deployment. This table provides storage only; the evaluation/rollout-strategy ADR remains an open decision (see DECISIONS.md Future Decisions).

Fields

* id (UUID)
* key (unique)
* enabled (boolean)
* rolloutPercentage (nullable)
* organizationId (nullable — null means platform-wide; set for a per-organization override, e.g., a beta tenant)
* updatedAt

Indexes

* key
* composite (key, organizationId)

---

## Activity Feed

Purpose

A denormalized, read-optimized feed of recent tenant-scoped events (distinct from the immutable, compliance-oriented Audit Logs) used to power restaurant-dashboard "recent activity" views without querying multiple source tables per page load. Populated asynchronously from domain events via BullMQ, not written synchronously in the same transaction as the originating action.

Fields

* id (UUID)
* organizationId
* restaurantId
* eventType
* summary
* metadata (jsonb)
* occurredAt

Indexes

* composite (organizationId, occurredAt)
* composite (restaurantId, occurredAt)

---

## Country

Purpose

Small, rarely-changing reference table backing the `Country` value object in DOMAIN_MODEL.md. Justification: hardcoding country/currency/locale defaults in application code would violate the "no hardcoded values" rule and make onboarding a new market a deployment rather than a data change.

Fields

* code (ISO 3166-1 alpha-2, primary key)
* name
* defaultCurrency
* defaultLocale
* isActive

---

## Currency

Purpose

Small, rarely-changing reference table backing the `Money` value object's currency codes, ensuring only recognized, correctly-formatted currencies (with the right decimal precision) are ever stored — e.g., JPY has 0 decimal places while most others have 2, which the application must respect when formatting/rounding `Money` values.

Fields

* code (ISO 4217 alpha-3, primary key)
* name
* symbol
* decimalPlaces
* isActive

---

# Relationships

Organization

↓

Organization Members

Organization

↓

Restaurants

↓

Branches

↓

Floor Plans

↓

Tables

↓

Reservations

↓

Reservation History

Branches

↓

Working Hours (branch-level override — deferred to Phase 5, not yet built)

Restaurant

↓

Working Hours (restaurant-level default — Phase 4.3)

Restaurant

↓

Restaurant Settings

Restaurant

↓

Restaurant Gallery

Restaurant

↓

Restaurant Cuisine Categories (many-to-many via `CuisineCategories`, platform-managed reference data — Phase 4.5)

Restaurant

↓

Restaurant Occasion Categories (many-to-many via `OccasionCategories`, platform-managed reference data — Phase 4.5)

Restaurant

↓

Restaurant Social Links

Restaurant

↓

Employees

↓

Employee Branch Assignments

Roles

↓

Role Permissions

↓

Permissions

Restaurant

↓

Menus

↓

Menu Categories

↓

Menu Items

Restaurant

↓

Offers

Restaurant

↓

Reviews

↓

Restaurant Replies

Organization

↓

Subscriptions

↓

Subscription Usage

Users

↓

User Preferences

Users

↓

Token Families

Users

↓

Device Sessions

Users

↓

Email Verification Tokens

Users

↓

Password Reset Tokens

Users

↓

Password History

Users

↓

User Consents

Users

↓

Platform Admins (optional — platform administration only)

---

# Soft Delete Policy

The following entities support soft delete:

* Organizations
* Users
* Restaurants
* Branches
* Tables
* Employees
* Menus
* Offers
* Reviews

Reservations are never physically deleted; a "deleted" User's personal data is anonymized in place rather than removed (see ADR-014) — the `Users` row itself is never hard-deleted or soft-deleted in the conventional sense, it transitions to `status = Anonymized` instead. `deletedAt` on Users, when present, refers to a distinct, ordinary account-deactivation path (e.g., a user pausing their account), not the GDPR erasure flow.

---

# Audit Policy

Every critical modification must create an audit record.

Examples

Reservation approved

Employee deleted

Restaurant updated

Subscription changed

Organization membership role changed

Organization ownership transferred

User account anonymized

---

# UUID Policy

All primary keys use UUID v7 (or UUID v4 if v7 is unavailable).

No auto-increment identifiers for business entities.

`Country.code` and `Currency.code` are the sole exceptions, using their respective ISO codes as natural primary keys since they are external, stable, universally-recognized identifiers.

---

# Timestamp Policy

Every table includes:

* createdAt
* updatedAt

Where applicable:

* deletedAt
* archivedAt

All timestamps are stored in UTC.

---

# Required PostgreSQL Extensions

* `btree_gist` — required for the exclusion constraint on `Reservations` that prevents overlapping confirmed bookings for the same table (see ADR-013). Enabled via the initial Prisma migration; documented in ENVIRONMENT_SETUP.md for every environment.
* `pgcrypto` or native `gen_random_uuid()` (PostgreSQL 13+) — required for UUID generation defaults.

---

# Indexing Policy

Create indexes for:

* Foreign keys
* Frequently searched columns
* Reservation date/time
* Status fields
* Slugs
* Email
* Phone

Composite indexes should be added for high-frequency queries, especially reservation availability lookups.

## Key Composite Indexes and Rationale

This section consolidates the highest-value composite indexes defined per-table above, since they protect the platform's most performance- and correctness-critical queries.

| Table | Index | Rationale |
|---|---|---|
| Reservations | (branchId, reservationDate, status) | Primary availability-search query: "find reservations for this branch on this date, excluding cancelled/expired" — the single highest-QPS query in the system. |
| Reservations | (tableId, reservationDate, reservationStartTime) | Serves the conflict-check performed inside the advisory-locked transaction (ADR-013) before confirming a new reservation. |
| Reservations | exclusion constraint on (tableId, time range) | Database-level safety net guaranteeing no overlapping confirmed reservation can exist, independent of application-layer locking (ADR-013). |
| Restaurant Tables | (branchId, tableNumber) unique | Enforces the business rule that table numbers are unique within a branch, and serves per-branch table listing. |
| Floor Plans | (branchId) partial unique WHERE isActive | Enforces at most one active floor plan per branch. |
| Organization Members | (organizationId, userId) unique | Enforces at most one membership role per user per organization; serves permission-resolution lookups on every authenticated request. |
| Role Permissions | (employeeId, permissionId) partial unique | Serves `PermissionResolver` RBAC queries (AUTHORIZATION_ARCHITECTURE.md). |
| Activity Feed | (organizationId, occurredAt) | Serves the dashboard's "recent activity" feed without scanning unrelated tenants' events. |
| Reviews | (reservationId) unique | Enforces "one reservation may produce only one review." |
| Reservation Waitlist Entries | (branchId, status, position) | Serves queue ordering and promotion (ADR-019). |
| Branches | (latitude, longitude) | Bounding-box nearby-restaurant queries (ADR-018). |
| Conversations | (organizationId, lastMessageAt) | Staff inbox sorted by recency (ADR-020). |
| Invoices | (organizationId, invoiceNumber) unique | Human-readable invoice lookup per tenant (ADR-021). |

---

# Migration Rules

* Every schema change requires a Prisma migration.
* Never modify production tables manually.
* All migrations must be reversible where possible.
* Migration files must be committed to version control.
* The initial migration must enable the `btree_gist` PostgreSQL extension before creating the `Reservations` table's exclusion constraint.
* Reference tables (`Country`, `Currency`, initial `Roles`/`Permissions`) are populated via the Seed System (see TASKS.md Phase 1), not via manual migration data, so environments remain reproducible.
