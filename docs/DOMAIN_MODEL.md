# DOMAIN_MODEL.md

# Enterprise Restaurant Reservation Platform

Version: **1.0**

---

# Purpose

This document defines the Domain Model of the Restaurant Reservation Platform.

It is the primary source of truth for the business domain.

Every new feature, module, service, or database table must align with this document.

The goal is to keep business rules independent from frameworks, databases, and external services.

---

# Domain Philosophy

The platform follows **Domain-Driven Design (DDD)**.

Business logic belongs to the Domain Layer.

Infrastructure exists only to support the domain.

The Domain Layer must never depend on:

* NestJS
* Prisma
* PostgreSQL
* Redis
* OneSignal
* Socket.IO
* BullMQ
* MinIO

---

# Bounded Contexts

The system is divided into the following bounded contexts:

1. Organization & Tenancy
2. Identity & Access
3. Restaurant Management
4. Reservation Management
5. Table Management
6. Customer Management
7. Employee Management
8. Menu Management
9. Review Management
10. Notification Management
11. Subscription & Billing
12. Analytics & Reporting
13. File Management
14. Platform Administration

Each bounded context owns its business rules, entities, repositories, and services.

No context may directly modify another context's internal models.

Communication should occur through interfaces or domain events.

The **Organization & Tenancy** context is the outermost boundary in the system: every other business context (Restaurant Management, Reservation Management, Subscription & Billing, etc.) operates *within* the scope of exactly one Organization at a time. See ADR-011 and ADR-012 in DECISIONS.md, and TENANCY.md, for the full rationale and enforcement mechanism.

---

# Aggregates

## Organization Aggregate

### Root

Organization

### Child Entities

* OrganizationMember
* OrganizationLimits (embedded value object, derived from the active Subscription plan)

### Responsibilities

* The tenant boundary for the entire platform (see ADR-011).
* Owns one or more Restaurants.
* Owns exactly one Subscription — plan *assignment* is always at the Organization level (a Restaurant never has its own independent plan; see ADR-011). Individual limits within that plan may still apply on a per-Restaurant basis (`maxBranchesPerRestaurant`, `maxEmployeesPerRestaurant`) rather than as an Organization-wide total — see the Subscription Aggregate below and ADR-027 for the precise per-limit enforcement grain.
* Owns membership and administrative roles across the restaurants it operates (`Owner`, `Admin`, `Billing`, `Staff` — distinct from restaurant-branch `Employee` roles, which govern day-to-day operational access rather than organization administration).

### Notes

* An Organization is created transparently during restaurant-owner signup; single-restaurant customers never need to know the concept exists in the UI — it exists purely as the correct domain/data boundary.
* `OrganizationMember` links a `User` to an `Organization` with an administrative role. One `User` may belong to multiple Organizations (e.g., a consultant or multi-brand operator); one Organization has one or more `OrganizationMember` records but exactly one member holds the non-transferable `Owner` role at any time.
* `OrganizationLimits` is not a separate persisted entity — it is computed from the active `SubscriptionPlan` (`maxRestaurants`, `maxBranchesPerRestaurant`, `maxEmployeesPerRestaurant` — no reservation-volume limit, ADR-027) and enforced by `SubscriptionValidator` (see Domain Services) whenever a new Restaurant, Branch, or Employee is created. `maxRestaurants` is checked against the Organization's own `SubscriptionUsage.restaurantCount`; `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant` are checked against the specific target Restaurant's own `RestaurantUsage` row, never an Organization-wide total (ADR-027) — see the Subscription Aggregate below.

---

## User Aggregate

### Root

User

### Child Entities

* DeviceSession
* FavoriteRestaurant

### Responsibilities

* Authentication
* Account lifecycle, including anonymization on account deletion (see ADR-014 and the GDPR / Privacy business rules below)
* User profile
* Preferences
* Device management
* Consent tracking (`UserConsent`)

### Notes

* Preferences (`language`, `preferredCurrency`, `notificationOptIn`, `marketingOptIn`) are plain fields on the `User` aggregate root, not a separate child entity — this corrects a pre-Phase-3.1 design that documented a standalone `UserPreference` child entity/table but was superseded once `language`/`preferredCurrency` shipped directly on `User` (Phase 3.1) and `notificationOptIn`/`marketingOptIn` followed the same shape (Phase 3.4). User-level preferences never affect another user's experience and are never tenant-scoped, distinct from `RestaurantSettings`.
* **Account status lifecycle** (`Pending`, `Active`, `Suspended`, `Locked`, `Deleted`, `Anonymized`) is defined in AUTHENTICATION_ARCHITECTURE.md §3 and DATABASE_SCHEMA.md. ~~`Pending` users cannot log in until email verification~~ — **per ADR-022** (2026-07-22), this applies only in the sense that a customer `User` row is never created before phone verification + password-setting complete (there is no `Pending` customer row to log into); a `Pending` Restaurant Owner row does not occur either, since administratively-provisioned Owners are created directly `Active`. `Locked` is a temporary brute-force state distinct from `Suspended`, unaffected by ADR-022.
* **Identity attributes by actor, per ADR-022:** `email` is the Restaurant Owner/staff identity attribute (unique, required for that path only); `phone` and `username` are the customer identity attributes (both nullable-unique on the shared `User` table, present only for customer-registered rows — no actor-discriminator column). `PhoneNumber` (below) is the value object customer `phone` is validated through.

### Pending Customer Registration (new, ADR-022 — not part of the `User` Aggregate)

A **separate, small entity** — not a child of the `User` aggregate, since it exists *before* any `User` identity does. Mirrors the existing precedent of `Employee.userId` being nullable so an `Employee` can be invited/persisted ahead of the `User` it will later link to (Authorization/Employee module). Fields (minimal, per ADR-022 — no unnecessary fields): `username`, canonical E.164 `phone`, OTP `codeHash`, `codeExpiresAt`, `incorrectAttemptCount`, verification state + timestamp, consumed/completed state, `createdAt`/`updatedAt`. Promoted into a real `User` row only on successful `COMPLETE`; never itself becomes or is mistaken for a `User`. **At most one active record per canonical phone** (frozen, ADR-022 Decision #18) — a repeated Start restarts/reissues the same record rather than creating a second one. Abandoned-row cleanup retention duration is an open item (ADR-022 "Remaining Open Items").

### Customer Password Reset Challenge (new, ADR-022 Decision #16 — not part of the `User` Aggregate, but references it)

A separate entity from `Pending Customer Registration` above, since it always references an **existing** `User` (`userId` FK) rather than staging a not-yet-existing identity — shaped like the existing `PasswordResetToken` plus the OTP fields already frozen for registration (`codeHash`, `codeExpiresAt`, `incorrectAttemptCount`, `verifiedAt`, `consumedAt`). Reuses every OTP security rule frozen for registration OTPs unmodified. Never reused for, or by, Restaurant Owner/staff recovery, which keeps the existing email-based `PasswordResetToken` flow unchanged.

---

## Restaurant Aggregate

### Root

Restaurant

### Child Entities

* Branch
* RestaurantSettings
* WorkingHours
* RestaurantGallery
* RestaurantSocialLinks
* RestaurantUsage (new, ADR-027 — Subscription usage counter scoped to this Restaurant; see Subscription Aggregate)

### Responsibilities

* Restaurant information
* Configuration
* Branch management

### Notes

* Every Restaurant belongs to exactly one Organization (`organizationId`, required, immutable after creation — see Organization Aggregate and ADR-011). A Restaurant is never itself the tenant boundary; the Organization is.
* Restaurant no longer carries a direct `ownerId` to a single User. Ownership and administrative access are expressed through the parent Organization's `OrganizationMember` records. A Restaurant's "owner" for display purposes is the Organization member holding the `Owner` role.
* `RestaurantSettings` is the value object holding `reservationInterval`, `maxGuestsPerReservation`, `cancellationWindow`, `autoApproval`, and `timezone` (unchanged from the original model), plus `defaultCurrency` (used only as a fallback when a Branch does not specify its own currency — see Branch Aggregate below and the Money/Currency Ownership note), `defaultReservationDurationMinutes` (Phase 7.1 — fallback `Reservation.reservationEndTime` derivation), and, as of Phase 7.6 (Operational Signals, ADR-019), `reservationReminderMinutesBefore` (default 60) and `lateArrivalGraceMinutes` (default 15) — the two per-restaurant offsets the Reminder and Late-Arrival BullMQ jobs read to compute their fire time relative to `reservationStartTime`.

---

## Branch Aggregate

### Root

Branch

### Child Entities

* Table
* FloorPlan
* EmployeeBranchAssignment (join entity linking Employee ↔ Branch, see Employee Aggregate)
* BranchWorkingHours (Phase 5.2 — branch-level working-hours override, a separate child entity from the Restaurant Aggregate's own `WorkingHours`, see DATABASE_SCHEMA.md "Branch Working Hours")

### Responsibilities

* Physical location
* Floor layout
* Working schedule
* Local employees
* **Currency and country ownership** (see Money/Currency Ownership below)

### Notes

* Each Branch declares its own `country` (Value Object) and `currency` (Value Object). This is a deliberate change from treating currency as a platform-wide or Restaurant-wide assumption: a restaurant chain headquartered in one country may operate branches in several countries, each transacting in its local currency. If a Branch does not explicitly set a currency, it inherits `Restaurant.settings.defaultCurrency`.
* `FloorPlan` is a child entity of Branch, not of Table, because a Branch may define more than one floor layout over time (e.g., a seasonal outdoor-seating layout vs. a standard indoor layout). Only one `FloorPlan` per Branch is `active` at a time; `Table.floor`/`positionX`/`positionY`/etc. are always interpreted relative to the currently active FloorPlan. See DATABASE_SCHEMA.md for the justification of `FloorPlan` as a real table rather than fields on Table.
* **Every Table belongs to exactly one FloorPlan** (Phase 6.1 architecture decision) - `Table.floorPlanId` is required, never nullable. A Branch with only a single physical floor still models it as one `FloorPlan` row (e.g., named "Main Floor"); there is no "no floor plan" state for a Table. This keeps future Move/Merge/Split and layout-rendering logic simple - every table is always positioned relative to a real, identifiable FloorPlan, never relative to an implicit or absent one.
* **FloorPlan is the owner of the table layout**: retrieving "all tables belonging to one FloorPlan" is a first-class read capability the architecture must support (Phase 6.1) - `TableRepository` must expose a lookup scoped by `floorPlanId`, not only by `branchId`. Exact endpoint shape is an implementation-time decision, not fixed here.
* **FloorPlan activation invariants** (Phase 6.1 architecture decision) - these are Aggregate Invariants enforced by the domain, not optional input validation:
  1. The first `FloorPlan` created for a Branch becomes `isActive = true` automatically; there is no manual activation step and no window where a Branch's only FloorPlan is inactive.
  2. Activating a different FloorPlan atomically deactivates the previously active one within the same operation - exactly one active FloorPlan per Branch at all times (enforced at the database level by the partial unique index on `branchId` WHERE `isActive`, see DATABASE_SCHEMA.md "Floor Plans").
  3. A FloorPlan cannot be deleted while any Table still references it via `floorPlanId` - the delete must be rejected, never silently reassigning or orphaning those Tables.
  4. The last remaining FloorPlan of a Branch cannot be deleted - a Branch must always own at least one FloorPlan, with no "zero floor plans" state ever reachable.
* **`Table.status` (Phase 6.1 decision, superseded by the Status Management architecture decision)** - `Create Table` still always produces `TableStatus.Available`. The enum now also defines `Occupied`, `Cleaning`, and `Disabled`, transitioned exclusively through the single dedicated Domain Action `POST /tables/{tableId}/status`, restricted to the transitions `Available ↔ Occupied`/`Available ↔ Cleaning`/`Available ↔ Disabled` only (see "Tables" section below for the full state machine). `Update Table` never transitions status. `Reserved` is approved for introduction as part of **Phase 7.2 — Approval Workflow** (Reservation Engine architecture frozen, see TASKS.md's Phase 7 pre-implementation decision note item 6 and the "Phase 7.2 — Approval Workflow: Architecture Freeze" note) - not yet added, since Phase 7.2 implementation has not started.
* **`Table.shape` is presentation metadata only (Phase 6.1 architecture decision)** - it describes floor-plan rendering and does not participate in reservation rules, capacity, or merge/split behavior. The initial `TableShape` enum is intentionally minimal: `Rectangle` and `Round` only. A square table is modeled as `Rectangle` with `width == height`, not a separate value. Any additional shape value requires its own future explicit architectural decision.

---

## Reservation Aggregate

### Root

Reservation

### Child Entities

* ReservationHistory
* ReservationGuest

### Responsibilities

* Reservation lifecycle
* Approval workflow
* Modification and rescheduling
* Cancellation
* Expiration
* No-show tracking
* Status transitions

### Notes

* `ReservationGuest` represents the person the reservation is for when no registered `User` account exists — required for phone reservations and walk-ins. It carries `fullName`, `phone`, and an optional `email`, all treated as personal data subject to the same anonymization obligations as User data (see GDPR / Privacy business rules). A Reservation has either a `userId` or a `ReservationGuest`, never neither, and only one of the two is authoritative for contact purposes at a time.
* `ReservationHistory` now explicitly records rescheduling events (old date/time → new date/time), not only status transitions, so a full audit trail of "what changed and when" survives independently of the mutable `Reservation` row.
* Walk-in reservations use `source = WalkIn` with a `ReservationGuest` (or linked `User` if the guest later registers). Staff creates them via the dashboard; same concurrency rules as online bookings (ADR-013).
* **Late arrival** and **table ready** are operational signals: staff or scheduled jobs emit domain events (`GuestLateArrivalNotified`, `TableReadyNotified`); `NotificationDispatcher` delivers templates. Timestamps `lateArrivalNotifiedAt` / `tableReadyNotifiedAt` prevent duplicate notifications (ADR-019).
* **Reminders** are scheduled BullMQ jobs reading `RestaurantSettings` reminder offsets; not a separate aggregate.
* **`reservationEndTime` lifecycle (Phase 7.1 architecture decision, 2026-07-20):** the Reservation aggregate always persists a concrete `reservationEndTime` - never null, never left for a downstream component to compute. If the client supplies `reservationEndTime`, the backend validates it (`reservationEndTime > reservationStartTime`, and against any configured Restaurant reservation-duration constraints) and stores exactly that value. If the client omits it, the backend derives it from the Restaurant's `Default Reservation Duration` setting (`RestaurantSettings`, see Value Objects above). The backend is the single source of truth for the persisted value in both cases - no downstream component (availability search, the advisory-lock/exclusion-constraint mechanism, `ReservationHistory`, notifications, analytics) ever needs to know whether a given reservation's end time was client-supplied or backend-derived; both are indistinguishable once persisted.
* **Availability Search semantics (Phase 7.1 architecture decision, 2026-07-20; Merge/Split amendment ADR-026, 2026-07-25):** Search Availability is informational only and never hides a qualifying candidate. Every **independently reservable** table matching the search criteria (branch, date/time, **effectiveCapacity** ≥ party size, `TableStatus = Available`) is returned, each carrying an availability indicator; a table already holding a `Pending` or `Approved` reservation for the requested window remains in the result set, marked Reserved/Unavailable rather than omitted. **ADR-026:** merge primaries use summed member capacity as `effectiveCapacity`; secondary `Merged` tables are excluded entirely (not candidates). The UI is responsible for how that state is displayed. Reservation conflict prevention is never performed by Availability Search - it remains exclusively the responsibility of Reservation creation itself, via the two independent layers ADR-013 already defines (the advisory lock and the database exclusion constraint), plus ADR-026 topology locks on Create/Approve/Reschedule. Availability Search results are therefore explicitly non-authoritative and may be stale by the time a client actually submits `POST /reservations`.

---

## Reservation Waitlist Aggregate

### Root

ReservationWaitlistEntry

### Responsibilities

* Queue guests when no table/slot is available (ADR-019)
* Position ordering per branch and service window
* Promotion to `Reservation` when capacity opens (`WaitlistPromotionService`)
* Expiration and cancellation

### Invariants

* Exactly one of `userId` or `reservationGuestId` must be set.
* `convertedReservationId` is immutable once set; status becomes `Converted`.
* Position is unique per active queue scope — `(branchId, preferredDate)`, not "branch + service window" (Phase 7.5 final decision, 2026-07-24, corrects the pre-implementation draft above).
* `ReservationGuest` is shared, never duplicated: a guest-backed entry's `reservationGuestId` and the `Reservation` created on promotion reference the exact same `ReservationGuest` row.
* No direct `organizationId` — tenant ownership is resolved transitively (`branchId -> Branch.restaurantId -> Restaurant.organizationId`), exactly like `Reservation` itself (Phase 7.5 tenancy correction; see ADR-019's implementation decision note in `DECISIONS.md`).

### Frozen state machine (Phase 7.5, 2026-07-24)

`Waiting -> {Notified, Converted, Cancelled, Expired}`; `Notified -> {Converted, Cancelled, Expired}`; `Converted`/`Cancelled`/`Expired` are terminal. `Notified -> Waiting` is not allowed. `Waiting -> Converted` is valid directly — notification is never a prerequisite for promotion.

**Implemented:** Phase 7.5 (Reservation Waitlist, architecture frozen 2026-07-24, implemented and live-verified 2026-07-24) — see ADR-019's Phase 7.5 implementation decision note in `DECISIONS.md` for the full frozen design (slot derivation, table selection, automatic-trigger set, FIFO fairness, promotion transaction).

---

## Messaging Aggregate

### Root

Conversation — tenant-resolved transitively via `restaurantId → Restaurant.organizationId` (ADR-030; no direct `organizationId`, same as `Branch`/`Reservation`).

### Child Entities

* ConversationParticipant — per-individual (`Customer`, `Staff`, `System`); a `Staff` row is either an `Employee` (`employeeId`) or an `OrganizationMember` acting as Restaurant-side (`userId`), never both (DECISIONS.md D2).
* Message — `senderType` (`Customer`, `Employee`, `OrganizationMember`, `System`) disambiguates `senderUserId`/`senderEmployeeId` (D3); optional `attachmentFileId` (`Files`, `ownerType = Message`); nullable `anonymizedAt` for GDPR compatibility (D10).

### State Machine

`ConversationStatus`: `Open -> {Closed, Archived}`, and `Closed`/`Archived -> Open` automatically whenever a new `Message` is sent (auto-reopen, D5). `Closed` is set by a Restaurant-side actor (closes for both sides); `Archived` is set by the Customer participant (soft-hides from their own list only, staff view unaffected).

### Responsibilities

* Customer–restaurant staff messaging (ADR-020, tenancy corrected by ADR-030)
* Optional linkage to `Reservation`
* Read receipts via per-participant `lastReadAt`
* Dual Actor authorization for the Restaurant side — `Employee` (branch-scoped, `conversations:manage`) or `OrganizationMember` (org-scoped, Owner/Admin) — resolved inside use cases exactly like Tables Merge/Split (ADR-026) and Analytics (ADR-028), never a third authorization model (DECISIONS.md D15)

### Policies

`ConversationPolicy` — a `Customer` may only read/send in a conversation where they are the `Customer` participant; a `Restaurant`-side actor must pass the Dual Actor check (D15) for the conversation's `restaurantId`/`branchId`. Cross-tenant or cross-branch resolution failures are IDOR-safe: unresolvable → `ConversationNotFoundException` (404); resolvable but unauthorized → `PermissionDeniedException`/`EmployeeBranchNotAssignedException` (403) (D14).

---

## Employee Aggregate

### Root

Employee

### Child Entities

* EmployeeRole
* EmployeePermissions
* EmployeeBranchAssignment

### Responsibilities

* Restaurant staff
* Access control
* Branch-level work assignment

### Notes

* An Employee belongs to exactly one Restaurant (unchanged), but is explicitly assigned to one or more Branches through `EmployeeBranchAssignment` rather than an implicit, undocumented `branchId` column. This makes multi-branch staff (e.g., an area manager covering three branches of the same restaurant) a first-class, intentional case rather than a schema field with no domain meaning.
* An Employee with **no** `EmployeeBranchAssignment` rows is scoped to the Restaurant level only (e.g., a restaurant-wide manager or accountant role) and may act across all of that Restaurant's branches; an Employee with **one or more** assignments is restricted to exactly those branches. See the Employee Branch Rules under Business Rules below for the precise authorization semantics.
* Permission resolution order (role grants, then individual overrides) is defined under Employee Permission Inheritance in Business Rules below.

---

## Menu Aggregate

**Architecture frozen 2026-08-02 (ADR-031, Phase 18), ownership/availability/isFeatured corrected 2026-08-03 (ADR-032) — not implemented, no Prisma model exists; implementation requires separate explicit authorization.** Resolves the roadmap gap recorded in `TASKS.md`'s Phase 15.5 note and `PRODUCT_REQUIREMENTS.md`'s `FR-08.1`.

### Root

Menu

### Child Entities

* MenuCategory
* MenuItem
* MenuItemOptionGroup — owned by `MenuItem`, not a direct child of `Menu`
* MenuItemOption — owned by `MenuItemOptionGroup`
* MenuItemAddOn — owned by `MenuItem`, sibling of `MenuItemOptionGroup`, not nested under it
* MenuItemAvailability — owned by `MenuItem`, sibling of `MenuItemOptionGroup`/`MenuItemAddOn`; populated only while `MenuItem.availabilityMode = Scheduled` (**ADR-032**, replaces `scheduleJson`)

### Responsibilities

* Restaurant-wide menu structure (Categories, Items) across one or more Menus per Restaurant (**ADR-032**)
* Per-item configurable pricing (Option Groups/Options, Add-ons)
* Per-item availability (Always / Unavailable / Scheduled), with Scheduled backed by relational `MenuItemAvailability` rows (**ADR-032**)
* Per-item featured flag for highlighting within the item's own public representation, with no Discovery/ranking integration (**ADR-032**)
* Category/Item imagery (delegates entirely to the existing `File`/MinIO infrastructure — no owned storage logic)

### Notes

* **Restaurant 1:N Menu, exactly one `isDefault` per Restaurant (corrected by ADR-032, 2026-08-03) — supersedes ADR-031's original singleton (`@@unique([restaurantId])`).** A Restaurant may own multiple Menus (breakfast/lunch/dinner/drinks/seasonal/QR/delivery, etc.); exactly one non-deleted Menu may be `isDefault = true`, enforced by a partial unique index reusing the `Table.isMergePrimary` mechanism (ADR-026) verbatim. `Restaurant.hasMenu` and the Customer public "the menu" read derive from the active, non-deleted, default Menu only — Discovery does not gain multi-menu awareness. This also resolves ADR-031's originally-open question of how a soft-deleted Menu interacts with uniqueness: the constraint no longer spans every row for a Restaurant, only non-deleted `isDefault` rows. See `DATABASE_SCHEMA.md` for the schema.
* **Currency tension with the Branch Aggregate's documented ownership model (flagged, not resolved by ADR-031 or ADR-032):** the Branch Aggregate's currency note above states "Currency is owned at the Branch level... every Money value used in a Branch's context (menu prices, deposit amounts, offers) is denominated in that Branch's currency... Business logic must never assume a single currency across an Organization's branches." Phase 18 nonetheless specifies `MenuItem.currency` as a per-item field, which is only self-consistent when every Branch of a Restaurant shares one currency — the common case, but not one this freeze can silently assume given the existing documented multi-currency warning. A Restaurant whose Branches use different currencies cannot be correctly served by a shared Menu without a future per-Branch price-override mechanism. This must be resolved (either as a product constraint — "a Restaurant's Branches must share one currency" — or a schema extension) before implementation begins.
* Like `Branch`/`Reservation`/`Review`/`Offer`, every Menu-family model is transitively-tenant-owned: a direct `restaurantId` FK, no `organizationId` column, not added to `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (`TENANCY.md`). `MenuCategory`/`MenuItem`/`MenuItemOptionGroup`/`MenuItemOption`/`MenuItemAddOn`/`MenuItemAvailability` additionally denormalize `restaurantId` directly (not only their immediate parent FK) so every tenancy resolution stays a single hop through `RestaurantRepository` regardless of nesting depth.
* `MenuItem.availabilityMode` (`Always` / `Unavailable` / `Scheduled`) is the only state-machine-like field in this aggregate; `Scheduled` requires at least one `MenuItemAvailability` row (day-of-week + time-window, **corrected by ADR-032** to a relational shape — the `Branch.openingHours` `Json`-column ADR-031 originally cited as precedent is documented elsewhere in this file as dead, superseded technical debt, not this codebase's actual convention, which is the relational `WorkingHours`/`BranchWorkingHours` shape). No other entity in this aggregate has lifecycle states — Category/OptionGroup/Option/AddOn are plain CRUD + soft-delete.
* `MenuItem.isFeatured` (**added by ADR-032**) is a pure, independently-mutable display flag with no cross-entity invariant and no dependency on any external system — evaluated and confirmed low-risk enough to add in the same freeze, unlike `sku` (see below).
* `MenuItem.sku` was evaluated and explicitly **not added** (ADR-032) — its correct shape depends entirely on a not-yet-scoped POS/Inventory/ERP integration contract; a nullable column can be added later at zero migration cost once that contract exists, whereas guessing its uniqueness scope now risks a corrective migration, the same mistake the original singleton Menu design made.
* No integration with Reservations, Reviews, Offers, Messaging, Analytics, Notifications, or Realtime (Phase 18 explicit scope, unchanged by ADR-032). Discovery exposes only a derived `Restaurant.hasMenu: boolean`. `Offer → MenuItem` reference is documented only as a Future Compatibility note, not implemented.

---

## Review Aggregate

### Root

Review

### Child Entities

* ReviewImage
* RestaurantReply

---

## Subscription Aggregate

**Architecture frozen 2026-07-28 (ADR-027) — entitlement/access contract, not billing.** A Subscription answers "what is this Organization allowed to do," never "how is this Organization being charged" — TAVLA does not process payments (ADR-021 Disposition). No trial, no proration, no `PastDue`/`Trialing` state exists.

### Root

Subscription

### Referenced / Related (not owned by this aggregate)

* `SubscriptionPlan` — platform-global reference data (TENANCY.md), referenced by `planId`, not a child entity of any one Subscription.
* `SubscriptionUsage` — Organization-scoped usage counter, 1:1 with Subscription's own Organization.
* `RestaurantUsage` — **owned by the Restaurant Aggregate, not this one** (see Restaurant Aggregate below) — called out here because it is the counterpart that makes per-Restaurant plan limits enforceable.

### Notes

* A Subscription belongs to exactly one **Organization**, not to a Restaurant (see ADR-011) — plan *assignment* is always Organization-level; a Restaurant never has its own independent plan.
* **Not every limit shares the same enforcement grain (ADR-027).** `maxRestaurants` is an Organization-wide aggregate, checked against `SubscriptionUsage.restaurantCount` (one row per Organization). `maxBranchesPerRestaurant` and `maxEmployeesPerRestaurant` are **per-Restaurant** limits — despite the Organization owning the one Subscription/Plan that defines their numeric value, each is checked against the specific target Restaurant's own `RestaurantUsage` row (one row per Restaurant, owned by the Restaurant Aggregate), never against an Organization-wide sum across every Restaurant it owns. Enforced by `SubscriptionValidator`.
* **No reservation-volume limit exists (ADR-027, owner product decision).** A Restaurant must never become unable to accept reservations because of its Organization's subscription tier. `CreateReservationUseCase` is not a Phase 12 enforcement touch point. Reservation-volume *measurement* (not restriction) is Phase 14 Analytics' concern, not Phase 12's.
* `SubscriptionUsage.restaurantCount` is recalculated incrementally as domain events occur (`RestaurantCreated` increments; a future Restaurant soft-delete would decrement) rather than computed from a live `COUNT(*)` query on every write. `RestaurantUsage.branchCount`/`employeeCount` follow the identical incremental principle, scoped to `BranchCreated`/`EmployeeCreated` events carrying that Branch's/Employee's own `restaurantId`.
* Lifecycle states: `Active`, `Suspended`, `Cancelled`, `Expired` — no billing-derived states (`PastDue`, `Trialing`). `Suspended` is an administrative pause (PlatformAdmin-initiated, reactivatable); `Cancelled` is a terminal state (not automatically reactivated — resuming requires a fresh plan assignment via the same Assign action used for provisioning); `Expired` is reached automatically when `endsAt` elapses (BullMQ-scheduled + CAS-guarded, mirroring the Offer expiration precedent, Phase 11).
* **An expired or suspended Subscription blocks only new resource creation** (`SubscriptionValidator`'s pre-creation checks) — it never mutates existing Restaurant/Branch/Employee state, and never gates any currently-completed feature (Reviews, Offers, Waitlist, Realtime, Notifications, Merge/Split, or reservation-taking itself). See "Restaurants" under Business Rules, below, for the explicit correction this makes to prior (pre-ADR-027) documentation.
* Assignment/plan-change is PlatformAdmin-only (no customer-facing purchase/checkout flow of any kind exists or is planned) — see AUTHORIZATION_ARCHITECTURE.md and ADR-027.

---

# Entities

Entities have unique identities.

Main entities include:

* User
* Restaurant
* Branch
* Table
* Reservation
* Employee
* Menu
* MenuCategory
* MenuItem
* MenuItemOptionGroup
* MenuItemOption
* MenuItemAddOn
* MenuItemAvailability
* Review
* Offer
* Notification
* Subscription
* File

---

# Value Objects

Value Objects are immutable.

Examples:

Address

Contains

* City
* District
* Street
* Postal Code
* Country

This example is illustrative only and is not currently mapped to any implemented aggregate (Branch's address fields are plain scalar columns, per DATABASE_SCHEMA.md's "Branches" section, not this Value Object).

---

PhoneNumber

Validates formatting and country code. **Formalized by ADR-022** (2026-07-22, Decision #13 — supersedes an earlier "no default-country inference" shorthand): the mobile Country Code Picker defaults to Syria (+963), changeable by the customer to any other supported country; this is a UX default only, never a backend nationality assumption. The backend is the authoritative normalization boundary — it validates the selected calling code against the entered national number and produces canonical E.164 regardless of which country was selected, never trusting client-side formatting alone and never substituting `+963` for an explicitly selected different code. Canonical E.164 (never the raw local number, never client-assembled input) is used identically for customer identity uniqueness, WhatsApp/LightOTP OTP delivery target (ADR-024), verification, account promotion, and login lookup. **Approved implementation library (ADR-022 Decision #14, installed and in production use):** `libphonenumber-js`, wrapped by the shared `PhoneNumber` value object (`src/shared/domain/value-objects/phone-number.vo.ts`) — hand-rolled parsing was explicitly rejected and never introduced.

---

EmailAddress

Validated immutable email.

---

GeoLocation

Latitude

Longitude

---

Country

ISO 3166-1 alpha-2 code

Default locale

Default currency

Country is a reference Value Object (backed by a small, rarely-changing lookup, see `Country` in DATABASE_SCHEMA.md) used by Branch to determine its default currency/locale unless explicitly overridden, and by Organization-level reporting to group restaurants by market.

---

Money

Currency

Amount

Supports multiple currencies.

**Currency ownership:** Currency is owned at the **Branch** level, not the Restaurant or platform level (revised from the original model — see ADR discussion in the Branch Aggregate notes above). Every `Money` value used in a Branch's context (menu prices, deposit amounts, offers) is denominated in that Branch's currency. `Restaurant.settings.defaultCurrency` exists only as a fallback for a Branch that hasn't explicitly configured one. Business logic must never assume a single currency across an Organization's branches — an aggregate report spanning multiple branches in different countries must present amounts per-currency or via an explicit, clearly-labeled conversion, never silently summed across currencies.

---

ReservationTime

Date

Start Time

End Time

Timezone

---

TablePosition

Position X

Position Y

Rotation

Width

Height

Layer

---

WorkingHours

Opening Time

Closing Time

Break Period

---

RestaurantSettings

Reservation Interval

Maximum Guests

Cancellation Window

Pending Reservation Timeout

Default Reservation Duration (Phase 7.1 architecture decision, 2026-07-20 - fallback used to derive `Reservation.reservationEndTime` whenever the client omits it; see Reservation Aggregate Notes)

Auto Approval

Timezone

Default Currency (fallback only — see Money/Currency Ownership above)

---

# Domain Services

AuthenticationService — identity verification, credential validation, session lifecycle. Does **not** evaluate permissions (ADR-017).

OrganizationMembershipService — validates and manages `OrganizationMember` role assignment, ownership transfer, and enforces the single-non-transferable-Owner invariant.

**PermissionResolver** — framework-independent domain service that computes effective RBAC permissions and branch scope for an Employee: `(RolePermissions ∪ IndividualGrants) − IndividualRevocations`, combined with `EmployeeBranchAssignment` records. Lives in the Authorization bounded context; invoked at login/refresh to embed claims in JWT and at runtime when `permissionsVersion` staleness is detected. See AUTHORIZATION_ARCHITECTURE.md §6.

**PolicyEngine** — orchestrates domain **Authorization Policies** (see below). Accepts a policy request (`actor`, `action`, `resource`, `context`) and returns allow/deny. Policies delegate to `PermissionResolver` for RBAC checks and add resource-specific ownership rules. NestJS-free interface in `domain/authorization/`.

ReservationAvailabilityService — computes availability and, per ADR-013, owns the advisory-lock-key derivation `(branchId, tableId, date, timeSlotBucket)` used to serialize conflicting reservation attempts. Framework-independent: the domain service defines *what* must be locked and *why*; the Infrastructure-layer repository implementation is responsible for actually acquiring the PostgreSQL advisory lock.

ReservationApprovalService

ReservationReschedulingService — validates rescheduling requests against the cancellation/reschedule window and re-runs availability checks for the new time slot.

NotificationDispatcher — application-layer orchestrator (Phase 9, implemented 2026-07-25): reacts to already-committed, already-published domain events on the frozen Phase 9 allow-list (`EVENTS.md`), resolves the correct `NotificationTemplate` for the recipient's `User.language`, persists the durable `Notification` row, then enqueues a `NotificationQueue` delivery job — never calls `NotificationProvider` synchronously inline with the triggering business transaction. See `TASKS.md`'s Phase 9 decision item 10 for the full chain.

SubscriptionValidator

AccountAnonymizationService — implements the anonymization mechanics defined in ADR-014; invoked by the `AnonymizeUserAccount` use case, never invoked implicitly by unrelated flows.

PricingCalculator

RestaurantSearchService — executes discovery queries per ADR-018: full-text and taxonomy filters in PostgreSQL for initial scale; optional external search index when restaurant count exceeds configured threshold. **Nearby** queries use branch `latitude`/`longitude`. **Comparison** returns a normalized DTO for a set of restaurant IDs (no separate aggregate). **Phase 15.5 v1 freeze (architecture frozen 2026-07-29, complete/live-verified/production-verified 2026-07-30):** "full-text" is `ILIKE` on `Restaurant.name` only (no `pg_trgm`/external index yet); "Nearby" is bounding-box + Haversine refinement on the existing geo B-tree index (no PostGIS/GiST); results are Restaurant-rooted with `nearestBranch`/`distanceKm` attached, never duplicated per branch. See `TASKS.md`'s Phase 15.5 decision note (D1-D17) for the full contract.

WaitlistPromotionService — promotes the next eligible `ReservationWaitlistEntry` when a table slot opens or staff triggers manual promotion; creates `Reservation` in the same transaction as waitlist status update.

ConversationService — creates threads, validates participants, appends messages; publishes `MessageSent` for WebSocket fan-out.

AnalyticsCalculator — **Phase 14, implemented and live-verified 2026-07-28 (ADR-028).** Not a stateful Domain Service — a set of stateless formula/calculation helpers (rate ratios, zero-fill bucketing, branch-local date derivation) invoked by Analytics Query Use Cases. Holds no state and issues no queries itself; `AnalyticsQueryPort` implementations own data access. See `TASKS.md`'s Phase 14 section for the frozen metric register.

FileStorageService (Interface Only)

NotificationProvider (Phase 9, frozen 2026-07-25, implemented 2026-07-25) — `send(params): Promise<NotificationSendResult>` where the result is one of `{ outcome: 'accepted', providerMessageId }` / `{ outcome: 'noRecipients' }` / `{ outcome: 'retryableFailure', reason }` / `{ outcome: 'permanentFailure', reason }`; provider-independent (OneSignal is the current adapter behind it, ADR-007 — application/domain code never calls OneSignal directly). See `TASKS.md`'s Phase 9 decision item 8.

---

# Authorization

Authorization is a separate bounded concern from Authentication (ADR-017, AUTHORIZATION_ARCHITECTURE.md). Authentication proves *who* the actor is; Authorization decides *what* they may do.

## Authorization Policies

Domain policies encapsulate resource-specific authorization rules. Each policy exposes a single decision method:

```
can(actor: AuthorizationActor, action: string, resource: unknown, context: PolicyContext): AuthorizationDecision
```

Business use cases depend on policies — they never embed permission logic inline.

| Policy | Responsibility |
|---|---|
| `ReservationPolicy` | Create, approve, cancel, reschedule reservations; ownership by customer vs staff |
| `RestaurantPolicy` | Restaurant settings, suspension, branch management |
| `TablePolicy` | Table CRUD, merge/split, availability overrides |
| `EmployeePolicy` | Invite, assign roles, branch assignments, deactivate |
| `OfferPolicy` | Offer lifecycle, publication |
| `MenuPolicy` (Phase 18, architecture frozen 2026-08-02, ADR-031, corrected 2026-08-03 by ADR-032 — not implemented) | Menu/Category/Item/OptionGroup/Option/AddOn/Availability management, gated by the new `menu:manage` permission slug for Employees; Owner/Admin full access via existing role hierarchy; Customer read-only, no ownership check (public data) |
| `ReviewPolicy` | Create review (post-completion, ownership); owning Customer or Restaurant Owner/Admin may delete; Restaurant Owner/Admin only may reply (zero-or-one, immutable); no Employee participation, no `reviews:reply` slug |
| `SubscriptionPolicy` | Plan limits, feature gating |
| `AnalyticsPolicy` | Report access by role and scope |
| `ConversationPolicy` | Chat read/send, participant membership |
| `WaitlistPolicy` | Join queue, promote, cancel waitlist entry |

**`AnalyticsPolicy` (Phase 14, implemented and live-verified 2026-07-28, ADR-028):** dual-actor, resolved by use-case-level branching — the same pattern ADR-026 (Merge/Split) and Phase 7.3 (Cancel/Reschedule) already established, not a new generic Policy Engine composition. Authorized: OrganizationMember Owner/Admin of the owning organization, **or** an Employee holding the existing `reports:view` permission slug and (for Branch-scoped queries) matching branch assignment. No new permission slug. See `AUTHORIZATION_ARCHITECTURE.md` for the full mechanism.

Policies compose `PermissionResolver` (RBAC) with **Ownership Rules** (resource-level checks).

## Ownership Rules

| Actor | Rule |
|---|---|
| Organization Owner | Full org-admin actions via `OrganizationMember.role`; operational actions require `Employee` record |
| Restaurant Owner | All branches of owned restaurant unless branch-restricted |
| Manager | Assigned branches; elevated operational permissions |
| Receptionist | Reservations and guest management within branch scope |
| Cashier | Front-of-house reservation actions within branch scope (no payment/checkout functionality — TAVLA does not process payments) |
| Customer | Own reservations, reviews, and profile only |
| Platform Admin | System-context client only; fully audited |

Full matrix: AUTHORIZATION_ARCHITECTURE.md §10.

## Permission Resolution

1. **Authentication** establishes identity and embeds `permissionsVersion`, `sessionVersion`, `actorType`, `organizationId` in JWT.
2. **Guards** (infrastructure) validate JWT and scope (`TenantScopeGuard`, `BranchScopeGuard`).
3. **Use case** invokes relevant `*Policy` before mutating state.
4. **PolicyEngine** calls `PermissionResolver` when RBAC check required; applies deny rules and overrides per AUTHORIZATION_ARCHITECTURE.md §14–16.

Permission changes increment `permissionsVersion` on the affected `Employee` (or `User` for org-level changes); stale JWTs are rejected on next refresh.

---

# Repository Interfaces

Repositories belong to the domain.

Examples

OrganizationRepository

OrganizationMemberRepository

UserRepository

RestaurantRepository

BranchRepository

TableRepository

ReservationRepository

EmployeeRepository

ReviewRepository

OfferRepository

MenuRepository (Phase 18, architecture frozen 2026-08-02, ADR-031 — not implemented)

MenuCategoryRepository (Phase 18, ADR-031 — not implemented)

MenuItemRepository (Phase 18, ADR-031 — not implemented)

MenuItemOptionGroupRepository (Phase 18, ADR-031 — not implemented)

MenuItemOptionRepository (Phase 18, ADR-031 — not implemented)

MenuItemAddOnRepository (Phase 18, ADR-031 — not implemented)

MenuItemAvailabilityRepository (Phase 18, added by ADR-032 — not implemented)

SubscriptionRepository

SubscriptionUsageRepository (ADR-027 — Organization-scoped `restaurantCount`)

RestaurantUsageRepository (ADR-027 — Restaurant-scoped `branchCount`/`employeeCount`; owned by the Restaurant Aggregate)

NotificationRepository

Repositories expose business-oriented operations rather than raw database access.

**Customer Restaurant Discovery & Public Read Surface (2026-07-28):** `DiscoveryReaderPort` (`modules/discovery/application/ports`) is deliberately not a repository in the above sense - it is a minimal, read-only, cross-tenant *reader* returning the same customer-safe Result shapes (`RestaurantResult`/`BranchResult`/`FloorPlanResult`/`TableResult`) the Restaurant/Branch/Tables modules' own use cases already produce, following the `RestaurantDirectoryReaderPort` precedent (Phase 3.3, Favorites) rather than duplicating aggregate logic. See TENANCY.md for why it queries the raw, un-tenant-scoped Prisma client.

---

# Domain Events

Examples

OrganizationCreated

OrganizationMemberInvited

OrganizationMemberRoleChanged

OrganizationOwnershipTransferred

UserRegistered

UserAccountAnonymized

RestaurantCreated

BranchCreated

TableCreated

ReservationCreated

ReservationApproved

ReservationRejected

ReservationCancelled

ReservationRescheduled

ReservationCompleted

ReservationExpired

ReservationNoShow

ReviewCreated

SubscriptionAssigned

SubscriptionPlanChanged

NotificationCreated (Phase 9, implemented 2026-07-25 — see EVENTS.md's "Notification Events" section; the Notification row's own `pushStatus` column, not a separate `NotificationSent` event, tracks push-delivery outcome — `ReservationReminderSent` is the one event-level "sent" signal Phase 9 defines, scoped specifically to the Reminder flow, see EVENTS.md)

MenuItemCreated (Phase 18, architecture frozen 2026-08-02, ADR-031, corrected 2026-08-03 by ADR-032, implemented 2026-08-03 — one representative example, see EVENTS.md's "Menu Events" section for the full 27-event catalog spanning Menu/Category/Item/OptionGroup/Option/AddOn/Availability)

Events are immutable and published only after successful business operations.

---

# Business Rules

## Organizations

* Every Restaurant belongs to exactly one Organization; an Organization may own one or more Restaurants.
* An Organization must have exactly one member holding the `Owner` role at all times; ownership may be transferred but never left vacant.
* Creating a Restaurant, Branch, or Employee beyond the active `SubscriptionPlan`'s limits is rejected with `OrganizationLimitExceededException`.
* Removing the last `Owner`-role member from an Organization is not permitted; ownership must be transferred first.

---

## Reservations

* A reservation must belong to exactly one branch.
* A reservation must reference exactly one table.
* A reservation cannot exist without a restaurant.
* A reservation must reference either a registered `User` or a `ReservationGuest`, never neither.
* Reservation time must be in the future at the moment of creation.
* **`reservationEndTime` is always persisted as a concrete value** (Phase 7.1 architecture decision, 2026-07-20): client-supplied and validated (`reservationEndTime > reservationStartTime`, within any configured Restaurant reservation-duration constraints), or backend-derived from the Restaurant's `Default Reservation Duration` setting when omitted. The backend is the single source of truth; the persisted row never records or exposes which path produced the value.
* Party size (`guests`) must not exceed the referenced table's **effective capacity** (**ADR-026:** unmerged = permanent `capacity`; merge primary = SUM of active merge-group member permanent capacities; secondary `Merged` tables are never reservation targets). Effective capacity (and `TableStatus = Available`) are the only *filters* applied by the availability search - a table already holding a `Pending`/`Approved` reservation for the requested window is still returned, marked Reserved/Unavailable rather than excluded (Phase 7.1 architecture decision, 2026-07-20; see Reservation Aggregate Notes for the full Availability Search contract). Secondary members with status `Merged` are never availability candidates.
* A table cannot have overlapping confirmed reservations. This is enforced at two independent layers, exclusively at Reservation creation/approval time, never by Availability Search: an application-level advisory lock scoped to `(branch, table, timeslot)`, and a database-level exclusion constraint as a safety net (see ADR-013).
* Two **pending** reservations for the same table and overlapping time window may both be created (since neither is yet confirmed), but only one may be approved; approving the first automatically rejects any other pending reservation whose time window overlaps the same table, with a system-generated note explaining the automatic rejection (implemented, Phase 7.2, 2026-07-23). **Neither manual nor automatic rejection performs any Table operation** (Phase 7.2 architecture correction, 2026-07-20, see TASKS.md's "Phase 7.2 — Approval Workflow: Architecture Correction" note): a reservation can only be rejected while still `Pending`, and a `Pending` reservation never calls `Table.reserve()` in the first place, so there is nothing to release.
* Pending reservations have a configurable expiration period (`RestaurantSettings.pendingReservationTimeout`); an expired pending reservation transitions automatically to `Expired` via a scheduled BullMQ job. **This does not release the table** (corrected, 2026-07-20, same reasoning as above): a `Pending` reservation never reserved the table, so its expiration has no Table state to release.
* A completed reservation cannot return to a pending state.
* A cancelled reservation cannot be approved.
* **Reservation modification/rescheduling (Phase 7.3 architecture decision, 2026-07-23 — resolves this rule's own prior ambiguity):** a `Pending` or `Approved` reservation's date, time, party size, **and assigned Table** may all be changed via Reschedule, only up until the restaurant's configured `cancellationWindow` before the reservation time, and only if the new date/time/table combination independently passes the same availability and locking checks as a new reservation (ADR-013, extended for the table-changing case by **ADR-023**'s deterministic two-key locking protocol). **A rescheduled Table must belong to the same Branch as the Reservation** - cross-branch/cross-restaurant movement is not permitted via Reschedule (mirroring Move Table's own Phase 6.2 precedent); changing Branch is a separate, not-yet-designed future workflow. Reschedule is always an in-place modification of the same `Reservation` row (same `id`, same aggregate) - it never cancels-and-recreates. Both the Customer (their own reservation only) and a branch-scoped Employee (`reservations:reschedule`) may reschedule. Each successful reschedule is recorded in `ReservationHistory` with both the old and new values (including `oldTableId`/`newTableId` when the table changes). Rescheduling within the cancellation window is rejected with `ReservationRescheduleWindowExpiredException`. **Table lifecycle:** a `Pending` reschedule (same or different table) performs no `Table` operation - a `Pending` reservation never reserves a table. An `Approved` reschedule to the *same* table leaves the table continuously `Reserved` (no release/re-reserve cycle). An `Approved` reschedule to a *different* table releases the old table and reserves the new one atomically with the reservation update, in one transaction (ADR-023) - the operation either fully succeeds or leaves the reservation, old table, and new table entirely unchanged. Rescheduling an `Approved` reservation into a new window/table automatically rejects any other overlapping `Pending` reservation for that table, via the identical mechanism (and identical "no Table operation") Phase 7.2 already established for Approval - a `Pending` reservation does not win a slot merely by being rescheduled into it.
* **Cancellation window:** a reservation may be cancelled by the customer without restriction outside `RestaurantSettings.cancellationWindow` before its scheduled time; cancellations inside the window are still permitted (a customer can always cancel) but are flagged (`withinCancellationWindow: true` on the resulting `ReservationHistory` entry) so the restaurant may apply its own late-cancellation policy (e.g., a no-show-equivalent record) — the platform does not itself charge cancellation fees in v1; that is deferred to the Payments ADR (see DECISIONS.md Future Decisions). Unlike Reschedule (above), the cancellation window never blocks Cancel itself - only Reschedule is rejected once the window has closed.
* **Cancel authorization (Phase 7.3 architecture decision, 2026-07-23):** both the Customer (their own reservation only, own-resource authorization, IDOR-safe) and a branch-scoped Employee (`reservations:cancel`) may cancel. **Table lifecycle:** `Pending → Cancelled` performs no Table operation; `Approved → Cancelled` calls `Table.release()` atomically with the cancellation, returning the table to `Available`.
* **Complete (Phase 7.3 architecture decision, 2026-07-23):** `Approved → Completed` only, staff-only (`reservations:complete`, branch-scoped) - a Customer cannot mark their own reservation Completed, and no background job does so automatically. A reservation may be marked Completed only once its scheduled service window has begun (the same "only after the relevant time has arrived" principle already applied to No-Show, below). `Table.release()` is called unconditionally in the same transaction, returning the table directly to `Available` - **never** through `TableStatus.Cleaning`, which remains an explicitly separate, manually/operationally-controlled state reachable only via Status Management's own `POST /tables/{tableId}/status` (Phase 6). Reservation Lifecycle operations own `Reserved`; they never decide `Cleaning`.
* **No-show policy:** a restaurant may mark a confirmed reservation as `NoShow` only after its scheduled time has passed and only if the guest never arrived (staff-only, `reservations:noshow`, branch-scoped, a dedicated permission slug distinct from `reservations:approve` - Phase 7.3 architecture decision, 2026-07-23); a `ReservationNoShow` event is published and contributes to that customer's (`User` or `ReservationGuest`, matched by phone number when no `User` exists) no-show count. `Table.release()` is called unconditionally in the same transaction, identically to Complete (never through `Cleaning`). A configurable threshold (`SystemConfiguration.noShowThreshold`) may restrict a customer with excessive no-shows to phone-only or manager-approved reservations — the specific restriction mechanism remains **a deferred future product decision, out of Phase 7.3's scope**; the counting and event are defined now so the data exists when the policy is implemented (no new schema is required for this - the existing `Reservation.userId`/`status = NoShow` rows are sufficient for a future consumer to compute a count).

---

## Tables

* Each table belongs to one branch.
* Table numbers are unique within a branch.
* Disabled tables cannot receive reservations.
* Tables under cleaning cannot be reserved.
* **Status Management (architecture decision):** the `Disabled`/`cleaning` states referenced by the two rules above are now defined. `TableStatus` consists of `Available`, `Occupied`, `Cleaning`, `Disabled`, `Reserved`, and **`Merged`** (**ADR-026 / Phase 6 Merge-Split freeze, 2026-07-25** — `Merged` is exclusively for **secondary** members of an active merge group; it is **not** a manual Status Management transition). `Reserved` is deliberately excluded from `Table.transitionStatus`/`POST /tables/{tableId}/status` - it is exclusively a Reservation Engine concept, implemented as part of **Phase 7.2 — Approval Workflow** (complete, live-verified, 2026-07-23; see TASKS.md's Phase 7 pre-implementation decision note item 6 and the "Phase 7.2 — Approval Workflow" report) via the new `Table.reserve()`/`Table.release()` domain methods only - `Table.transitionStatus` itself continues to reject `Reserved` as either the current or target status. **`Merged` is likewise rejected by `Table.transitionStatus` / the generic status endpoint** — only Merge/Split may set or clear secondary `Merged` as part of their atomic topology transition. Status transitions (via `POST /tables/{tableId}/status`) go through a single dedicated Domain Action - there are no separate Disable/Enable actions, since disabling and enabling are not independent business capabilities but state transitions within the same lifecycle. Allowed transitions are restricted to `Available ↔ Occupied`, `Available ↔ Cleaning`, and `Available ↔ Disabled` only; every other combination (e.g. `Cleaning → Occupied`, `Occupied → Disabled`, `Disabled → Cleaning`, any transition involving `Merged` or `Reserved`) is an invalid transition and must be rejected with a business validation error - there are no implicit transitions. `Update Table` (`PATCH /tables/:tableId`) never changes `status` - this is the only operation that does. Status transitions publish `TableStatusChanged` (Phase 8) for manual transitions only.
* **Move Table (Phase 6.2 architecture decision; Merge/Split guard per ADR-026):** a dedicated Domain Action, not a generic resource update - it reassigns an existing Table's `floorPlanId` to a different FloorPlan within the same Branch, and changes nothing else (`branchId`, `tableNumber`, `capacity`, `shape`, position/rotation/dimensions, `status`, and `mergeGroupId`/`isMergePrimary` are all untouched by this operation). Cross-branch and cross-restaurant movement are not allowed. The target FloorPlan need not be the branch's currently active one, but must not be soft-deleted. **Move is forbidden for any table participating in an active merge group (primary or secondary); the group must be Split first** (ADR-026) — no cascading move of a whole group. `Update Table` remains responsible only for a Table's own attributes and must never change `floorPlanId` - Move Table is the only operation that does. Move Table publishes `TableMoved` (Phase 8).
* **Merged tables (ADR-026, architecture frozen 2026-07-25 — Primary Table model):** merging two or more **existing** Tables (N ≥ 2) assigns a shared `mergeGroupId`, marks exactly one member `isMergePrimary = true` (caller-supplied `primaryTableId` or deterministic lowest `tableNumber` then `Table.id`), and sets every **secondary** member's status to `Merged`. The **primary** remains the identity of the reservable unit (`Reservation.tableId` for reservations against the merged unit = primary.id). Permanent `capacity` columns are never overwritten; **effective capacity** of the primary while merged = **sum** of all members' permanent capacities. All members must belong to the **same Branch** and **same FloorPlan**, must be `Available` at merge time, and must not already belong to another merge group. Nested merges are forbidden. Merge is rejected if any component has a **Pending** or **Approved** reservation whose `reservationEndTime` has not yet passed — those reservations must be resolved through existing Reservation APIs first (no automatic reassignment; ADR-023 is not invoked by Merge). Publishes `TableMerged`.
* **Splitting (ADR-026):** Split means **only** undoing an existing merge group (never subdividing one physical table into newly created Table rows). Rejected if the **primary** has a non-ended Pending or Approved reservation (`reservationEndTime` rule). On success: clear `mergeGroupId`/`isMergePrimary`; secondaries return to `Available`; primary remains/returns `Available` subject to reservation state; each Table keeps its original id and permanent capacity; historical reservations continue to reference the (former) primary id. Publishes `TableSplit`.

---

## Restaurants

* Each restaurant owns one or more branches, and belongs to exactly one Organization (see Organizations above).
* Suspended restaurants (`RestaurantStatus.Suspended`, an Owner/Admin-controlled operational state, unrelated to subscriptions) cannot receive new reservations. Existing confirmed reservations at a suspended restaurant remain valid and must still be honored (suspension blocks new bookings, it does not cancel existing commitments); restaurant staff retain access only to fulfil already-confirmed reservations, not to create new ones.
* **Subscription state does not gate restaurant operations (corrected 2026-07-28, ADR-027 — supersedes prior text in this section).** An expired, suspended, or cancelled Organization Subscription never mutates `Restaurant.status`, never blocks existing reservation-taking, and never disables any currently-completed feature (Reviews, Offers, Waitlist, Realtime, Notifications, Merge/Split). Its only effect is blocking *new* Restaurant/Branch/Employee creation beyond the plan's limits (`SubscriptionValidator`, pre-creation). `RestaurantStatus.Suspended` remains exclusively an Owner/Admin-initiated operational state (`PATCH /restaurants/:id`) — Phase 12 does not write to it, avoiding two independent actors (subscription lifecycle vs. Owner/Admin) contending over the same field. See Subscription Aggregate, above, and ADR-027 for the full reasoning (this correction resolves a stale, pre-payment-removal assumption that no longer matches the owner-approved "no gating of currently completed features" decision).
* **Branch deletion:** a Branch may only be soft-deleted if it has no `Pending` or `Approved` reservations with a future date/time; a Branch with future reservations must have them cancelled, completed, or migrated to another branch first. Soft-deleting a Branch cascades to soft-deleting its **Tables and FloorPlans** (Phase 6.1 architecture decision - both are child entities of the Branch Aggregate, so cascading to both is aggregate consistency, not a new feature) but never its historical Reservations, which are immutable per the Soft Delete Policy in DATABASE_SCHEMA.md. **This cascade must execute inside a single database transaction - partial completion is forbidden.** The system must never reach a state where the Branch is soft-deleted but its Tables and/or FloorPlans are not (or any other partially-applied combination); a failure partway through must roll back the entire operation, leaving the Branch, its Tables, and its FloorPlans exactly as they were before the delete was attempted.

---

## Employees

* Employees belong to one restaurant.
* Permissions are role-based and may be extended individually.
* Deactivated employees cannot authenticate.
* **Employee branch rules:** an Employee with no `EmployeeBranchAssignment` records operates at restaurant-wide scope and may act on any of that restaurant's branches; an Employee with one or more assignments is restricted to exactly those branches and any action scoped to a different branch is rejected with `EmployeeBranchNotAssignedException`, regardless of role.
* **Employee permission inheritance:** an Employee's effective permission set is resolved as `(RolePermissions ∪ IndividualGrants) − IndividualRevocations`. Role-level permissions form the baseline; an individually-granted permission adds to that baseline; an individually-revoked permission removes a permission the role would otherwise confer. Revocations always take precedence over grants when both target the same permission on the same employee (an explicit revocation is a deliberate narrowing and must not be silently overridden by the role default). Permission resolution is performed by `PermissionResolver` (see Domain Services / Authorization) and is embedded in short-lived JWT claims at authentication time rather than recomputed from the database on every request, refreshed whenever a role or override changes (see NON_FUNCTIONAL_REQUIREMENTS.md's "never cache permission checks" rule, clarified: this refers to never trusting a long-lived cache as the source of truth across a role change, not to recomputing from Postgres on every single request).

---

## Reviews

**Phase 10 architecture frozen (owner-approved) — see `TASKS.md`'s "Phase 10 — Reviews: Pre-implementation architecture decisions" for the full freeze report.**

* Reviews may only be created after a completed reservation (`Reservation.status === Completed`) by the User who owns that reservation (`Reservation.userId === principal.userId`) — ownership-based authorization, identical mechanism to Reservations/Notifications (AUTHORIZATION_ARCHITECTURE.md §10).
* A guest-only reservation (`Reservation.userId === null`, `reservationGuestId !== null` — Phone/WalkIn, Phase 7.4) is **not** review-eligible in Phase 10. There is no identity-linking mechanism from a `ReservationGuest` to a later-registered `User` in this phase.
* One reservation may produce only one review (enforced by a unique constraint on `Review.reservationId`). This constraint is permanent, not conditional on `deletedAt` — **deleting a Review does not restore eligibility to submit another Review for that same reservation.**
* A Review's `rating` is a mandatory integer from 1 to 5 inclusive (`CHECK` constraint). `comment` is optional. There is no rating-only-vs-comment-only distinction beyond rating being required and comment not.
* Reviews are **immutable after creation** — no rating/comment edit capability exists. (`ReviewUpdated`, previously listed under Domain Events, is removed/deferred — see Events below.)
* Review deletion is a **soft delete** (`deletedAt`), never physical. A deleted Review stops contributing to `Restaurant.averageRating` and is never returned by any read path, but its row (and its `reservationId` uniqueness claim) persists permanently.
* A Review may be deleted by **either** the Customer who owns it, **or** an Organization Owner/Admin of the Restaurant it belongs to (administrative deletion). Employees may not delete Reviews in Phase 10.
* Restaurant owners (Organization Owner/Admin — never a `Restaurant.ownerId`, per AUTHORIZATION_ARCHITECTURE.md §10) may reply once to a review — `RestaurantReply` is zero-or-one per `Review`, enforced by a unique constraint on `RestaurantReply.reviewId`. Employees do not reply to reviews in Phase 10; no `reviews:reply` (or similar) permission slug exists. A `RestaurantReply` is immutable once created — no edit, no delete, no repost after any hypothetical removal (none exists).
* Review images reuse the existing Files/MinIO pipeline (`FileOwnerType.Review`) — no second upload subsystem. Maximum 5 images per Review, same MIME/size/security policy as Restaurant Gallery images. The reviewing Customer may delete an individual image from their own Review (soft delete, same convention as every other file-owning deletion in this codebase) — this does not make the Review's `rating`/`comment` editable, and does not itself delete the Review.
* `Restaurant.averageRating` is maintained **transactionally**: recomputed as `AVG(rating)` over that restaurant's active (`deletedAt IS NULL`) Reviews, inside the same database transaction as the triggering Review create/delete, using a row-level lock on the `Restaurant` row to serialize concurrent recomputes for the same restaurant (no new advisory-lock namespace; ADR-013/ADR-023/ADR-026 are unaffected). `averageRating` is `null` when a restaurant has zero active reviews — never `0`.
* `Review.restaurantId` is the tenant-resolution hop (`Review.restaurantId → Restaurant.organizationId`, TENANCY.md) — `Review` carries no `organizationId` column and is not in `DIRECT_TENANT_OWNED_MODELS`. `Review.userId` is the separate ownership-authorization column, spanning organizations exactly like `Reservation.userId`.
* No Review moderation/status workflow, no realtime (Phase 8) broadcasting, and no notification (Phase 9/OneSignal) side effects exist for any Review event in Phase 10.

---

## Notifications

**Phase 9 pre-implementation architecture decisions frozen 2026-07-25** (`TASKS.md`'s "Phase 9 — Notification System: Pre-implementation architecture decisions") — implemented 2026-07-25 exactly as frozen; rules below describe the shipped design.

* A `Notification` is a durable record, not merely a WebSocket event — Phase 8's realtime fan-out is a best-effort presentation hint layered on top of it, never a substitute; a missed WebSocket event must never mean a lost notification. REST/the database is the source of truth.
* Notifications are generated only after successful business actions, from an explicit, frozen event→notification allow-list (`EVENTS.md`) — not automatically from every domain event.
* `Notification` recipients are `User` (Customer) only in v1. `Employee`/`OrganizationMember` inboxes and `ReservationGuest` eligibility are explicitly deferred/excluded (no authenticated account/inbox identity exists for a guest) — contact-data existence (`ReservationGuest.phone`/`email`) and notification-recipient eligibility are kept as separate concerns; this does not forbid a future guest-reachable channel.
* A `Notification`'s in-app read state (`read`/`readAt`) and its push-delivery state (`pushStatus`/`pushSentAt`/`pushFailedAt`) are independent — reading in-app history never depends on whether push delivery was attempted, succeeded, or failed.
* Push delivery failures are retried through background jobs (BullMQ, `NotificationQueue`), following the platform's existing best-effort/log-and-swallow convention for non-critical post-commit work (the same pattern already used for the Waitlist re-check enqueue in Cancel/NoShow) — not a transactional-outbox-backed guarantee. A process crash between persisting the `Notification` row and enqueuing its delivery job loses only that notification's push attempt, silently; the durable in-app record is never lost, since it is written first, before the delivery job is even enqueued.
* `NotificationProvider` implementations must be interchangeable (ADR-007's Anti-Corruption Layer) — application/domain code never communicates with a specific provider (e.g. OneSignal) directly.
* Notification content is resolved through a `NotificationTemplate` in the recipient's preferred language (`User.language`); if no translation exists for that language, the template's configured default-language (`isDefault`) version is used — a notification is never sent with a missing/blank body. Templates are platform-global in v1 (no restaurant-specific override), and `Push`/`InApp` may carry separate content for the same event/language.
* `User.notificationOptIn` (default `true`) governs **Push delivery only** — it never suppresses durable in-app notification creation for transactional reservation-lifecycle events; a Customer who disables it still sees their notification history in-app, they simply never receive an external push for it. `User.marketingOptIn` remains unrelated to transactional reservation notifications (reserved for a future promotional-notification category, out of Phase 9 v1 scope).
* Push notification content (and the resolved in-app `title`/`body`, since both go through the same template mechanism) contains only the minimum user-facing information necessary — never `ReservationGuest.phone`/`email`/`fullName`, internal audit identifiers, or reservation notes; prefer generic, lock-screen-safe wording, with full detail retrievable only after the Customer opens the authenticated app (mirrors, but is stricter than, Phase 8's own WebSocket PII-minimization precedent, since a push can appear on a locked screen).
* A `Notification` carries no `organizationId` — a Customer's notification inbox spans every organization they've ever booked with, exactly like `Reservation.userId` itself already does; deliberately avoiding the Phase 7.5 `ReservationWaitlistEntry.organizationId` mistake of requiring a tenant context a Customer actor does not possess.

---

## Subscriptions

* A Subscription belongs to exactly one Organization.
* Downgrading a plan is rejected if the Organization's current usage (restaurants, branches, employees) exceeds the target plan's limits; the limits must be brought within range first (e.g., by deactivating branches) before the downgrade is accepted.
* Plan limits are enforced at the point of creating a new Restaurant, Branch, or Employee, not retroactively against existing data.

---

## GDPR / Privacy

* Account deletion is satisfied through anonymization-in-place, never physical deletion of the `User` row (see ADR-014). Personal data on any secondary entity that stores it directly — e.g., `ReservationGuest.fullName`/`phone`/`email` for phone/walk-in bookings tied to the same real person — must be anonymized through the same `AccountAnonymizationService` pass when a matching account-deletion request is verified (matched by phone number/email at the time of the request), so personal data does not persist in a secondary location after the primary account is anonymized.
* Anonymization is irreversible and only executes after a configurable grace period (`SystemConfiguration.anonymizationGracePeriodDays`, default 30) during which the user may cancel the request.
* Data export (right to portability) must be offered before or during the deletion flow, never only after.
* Consent (`UserConsent`) is recorded with a timestamp and the specific terms version accepted; consent is never inferred from continued platform usage alone.

---

# Use Cases

## Authentication

* Register User
* Login
* Refresh Session
* Logout
* Verify Email
* Reset Password

## Authorization

* Assign Employee Role
* Grant Individual Permission
* Revoke Individual Permission
* Assign Employee to Branch
* Revoke All Sessions (session version bump)

---

## Privacy

* Export User Data
* Request Account Deletion
* Cancel Account Deletion Request (within grace period)
* Record Consent

---

## Organization

* Create Organization (typically implicit during restaurant-owner signup)
* Invite Organization Member
* Change Organization Member Role
* Remove Organization Member
* Transfer Ownership

---

## Restaurant

* Create Restaurant
* Update Restaurant
* Create Branch
* Update Branch
* Suspend Restaurant
* Delete Branch

---

## Tables

* Create Table
* Update Table
* Move Table
* Merge Tables
* Split Tables
* Disable Table
* Change Table Status

---

## Reservations

* Search Availability
* Create Reservation
* Approve Reservation
* Reject Reservation
* Cancel Reservation
* Reschedule Reservation
* Complete Reservation
* Mark No Show
* Create Phone Reservation
* Create Walk-In Reservation
* Join Reservation Waitlist
* Promote Waitlist Entry
* Notify Guest Late Arrival
* Notify Guest Table Ready

---

## Employees

* Invite Employee
* Update Employee
* Assign Role
* Assign Employee to Branch
* Remove Employee from Branch
* Remove Employee

---

## Reviews

* Submit Review (Customer, own Completed reservation)
* Delete Review (owning Customer, or Restaurant Organization Owner/Admin)
* Reply to Review (Restaurant Organization Owner/Admin only; zero-or-one, immutable)
* Delete Review Image (owning Customer, own Review only)

No Update Review action exists (Reviews are immutable after creation).

---

## Offers

* Create Offer (Owner/Admin, `Draft`)
* Update Offer (Owner/Admin, `Draft` only — immutable once `Published`/`Expired`)
* Publish Offer (Owner/Admin, `Draft -> Published`)
* Expire Offer (System, BullMQ-scheduled CAS, `Published -> Expired`)
* Delete Offer (Owner/Admin, soft delete, any state)

**Phase 11 freeze (2026-07-28), implemented and live-verified the same day:** single generic `Offer` aggregate with a `type` discriminator (`Promotion`/`Coupon`/`Event`) — see `DATABASE_SCHEMA.md`. No Employee actor exists for any Offer action (no `offers:*` permission slug, same declined-scope shape as Phase 10's `reviews:reply`). No Happy Hour / recurring-schedule concept in Phase 11.

---

## Menu Management

* Create Menu (Owner/Admin or Employee with `menu:manage`; **1:N per Restaurant, corrected by ADR-032** — the first Menu created for a Restaurant is auto-marked `isDefault`)
* Update Menu (active/inactive, `displayOrder`)
* Set Default Menu (**added by ADR-032**; atomically unmarks the prior default in the same transaction)
* Delete Menu (soft delete) — **added at implementation time (2026-08-03)**, the same CRUD-symmetry gap-fill already applied below to Option Group/Option/Add-on, extended to Menu itself since it is equally soft-deletable
* Create Category
* Update Category
* Delete Category (soft delete)
* Reorder Categories (bulk `displayOrder` replacement)
* Create Item
* Update Item (includes availability-mode and `isFeatured` changes — no separate endpoint)
* Delete Item (soft delete)
* Reorder Items (bulk `displayOrder` replacement, scoped to one Category)
* Replace Item Availability Windows (**added by ADR-032**; bulk whole-set replacement of `MenuItemAvailability` rows, Scheduled mode only, same convention as Reorder)
* Create Option Group
* Update Option Group
* Delete Option Group (soft delete)
* Create Option
* Update Option
* Delete Option (soft delete)
* Create Add-on
* Update Add-on
* Delete Add-on (soft delete)
* List Restaurant Menus (Customer, public — **corrected by ADR-032** from a single-resource read to a collection read, since a Restaurant may own more than one Menu)
* Get Menu (Customer, public, full nested tree for one Menu — defaults to the Restaurant's `isDefault` Menu when none is specified)
* Get Category (Customer, public)
* Get Item Details (Customer, public)

**Phase 18 freeze (2026-08-02, ADR-031), ownership/availability/isFeatured corrected 2026-08-03 (ADR-032) — architecture only, not implemented.** Update/Delete for Option Group, Option, and Add-on are added beyond the Phase 18 brief's literal endpoint list, for CRUD symmetry with Category/Item and to satisfy the brief's own "soft delete all entities" requirement (a soft-deletable entity needs a Delete operation) — flagged as a Remaining Decision pending confirmation, not a unilateral scope expansion. No Reservations/Reviews/Offers/Messaging/Analytics/Notifications/Realtime integration (unchanged by ADR-032). Discovery exposes only a derived `hasMenu: boolean`.

---

## Discovery & Search

* Search Restaurants
* Find Nearby Restaurants
* Compare Restaurants
* Filter by Cuisine Category
* Filter by Occasion Category
* Filter by Price Level

---

## Messaging

* Start Conversation
* Get Conversation
* Send Message
* List Customer Conversations
* List Restaurant Conversations
* List Messages
* Mark Conversation Read
* Close Conversation (actor-branched: Restaurant-side → `Closed`, Customer → `Archived`, D5)

---

## Subscription

* Upgrade Plan
* Downgrade Plan
* Renew Subscription
* Cancel Subscription

---

# Invariants

The following conditions must always remain true:

* Every restaurant belongs to a valid organization.
* Every organization has exactly one member holding the `Owner` role.
* Every reservation references an existing table.
* Every reservation references either a valid user or a valid reservation guest, never neither.
* Every table belongs to a valid branch.
* Every branch belongs to a valid restaurant.
* Every employee belongs to a restaurant.
* An employee's branch assignments, if any, always reference branches of that same employee's restaurant.
* Every review belongs to a completed reservation.
* Every subscription belongs to a valid organization.
* Every uploaded file has an owner and access policy.

Violation of an invariant must result in a domain exception.

---

# Domain Exceptions

Examples:

ReservationConflictException

TableUnavailableException

RestaurantSuspendedException

SubscriptionExpiredException

OrganizationLimitExceededException

PermissionDeniedException

TenantContextMissingException

EmployeeBranchNotAssignedException

InvalidReservationTimeException

ReservationRescheduleWindowExpiredException

PartySizeExceedsCapacityException

BranchNotFoundException

BranchHasFutureReservationsException

TableNotFoundException

TableMergeConflictException

ReservationAlreadyCompletedException

ReservationAlreadyCancelledException

ReviewAlreadyExistsException

ReviewAlreadyRepliedException

Exceptions should express business failures, not infrastructure failures.

---

# Anti-Corruption Layer

External services must never leak into the domain.

Adapters should translate between external APIs and internal models.

Examples:

OneSignal Adapter

MinIO Adapter

SMTP Adapter

Socket.IO Adapter

This ensures the domain remains independent of third-party technologies.

---

# Future Evolution

The domain model is intentionally designed to support future migration toward microservices.

Potential future bounded contexts that can become independent services:

* Reservation Service
* Notification Service
* Analytics Service
* Search Service
* Identity Service
* Recommendation Service
* Loyalty & Rewards Service
* Organization & Tenancy Service (organization membership, billing linkage, and subscription-limit enforcement — a natural extraction point once Organization exists as an explicit aggregate, see ADR-011)

---

# Domain Rule

When uncertainty exists between technical convenience and business correctness:

**Business correctness always takes precedence.**

The domain model is the highest authority in the system.

Any implementation that violates this document should be considered incorrect, even if it functions technically.
