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
* Owns exactly one Subscription (billing and plan limits are consolidated at the Organization level, not per-restaurant).
* Owns membership and administrative roles across the restaurants it operates (`Owner`, `Admin`, `Billing`, `Staff` — distinct from restaurant-branch `Employee` roles, which govern day-to-day operational access rather than organization administration).

### Notes

* An Organization is created transparently during restaurant-owner signup; single-restaurant customers never need to know the concept exists in the UI — it exists purely as the correct domain/data boundary.
* `OrganizationMember` links a `User` to an `Organization` with an administrative role. One `User` may belong to multiple Organizations (e.g., a consultant or multi-brand operator); one Organization has one or more `OrganizationMember` records but exactly one member holds the non-transferable `Owner` role at any time.
* `OrganizationLimits` is not a separate persisted entity — it is computed from the active `SubscriptionPlan` (max restaurants, max branches, max employees, max monthly reservations) and enforced by `SubscriptionValidator` (see Domain Services) whenever a new Restaurant, Branch, or Employee is created.

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
* **Account status lifecycle** (`Pending`, `Active`, `Suspended`, `Locked`, `Deleted`, `Anonymized`) is defined in AUTHENTICATION_ARCHITECTURE.md §3 and DATABASE_SCHEMA.md. `Pending` users cannot log in until email verification; `Locked` is a temporary brute-force state distinct from `Suspended`.

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

### Responsibilities

* Restaurant information
* Configuration
* Branch management

### Notes

* Every Restaurant belongs to exactly one Organization (`organizationId`, required, immutable after creation — see Organization Aggregate and ADR-011). A Restaurant is never itself the tenant boundary; the Organization is.
* Restaurant no longer carries a direct `ownerId` to a single User. Ownership and administrative access are expressed through the parent Organization's `OrganizationMember` records. A Restaurant's "owner" for display purposes is the Organization member holding the `Owner` role.
* `RestaurantSettings` is the value object holding `reservationInterval`, `maxGuestsPerReservation`, `cancellationWindow`, `autoApproval`, and `timezone` (unchanged from the original model), plus a new `defaultCurrency` used only as a fallback when a Branch does not specify its own currency (see Branch Aggregate below and the Money/Currency Ownership note).

---

## Branch Aggregate

### Root

Branch

### Child Entities

* Table
* FloorPlan
* EmployeeBranchAssignment (join entity linking Employee ↔ Branch, see Employee Aggregate)

### Responsibilities

* Physical location
* Floor layout
* Working schedule
* Local employees
* **Currency and country ownership** (see Money/Currency Ownership below)

### Notes

* Each Branch declares its own `country` (Value Object) and `currency` (Value Object). This is a deliberate change from treating currency as a platform-wide or Restaurant-wide assumption: a restaurant chain headquartered in one country may operate branches in several countries, each transacting in its local currency. If a Branch does not explicitly set a currency, it inherits `Restaurant.settings.defaultCurrency`.
* `FloorPlan` is a child entity of Branch, not of Table, because a Branch may define more than one floor layout over time (e.g., a seasonal outdoor-seating layout vs. a standard indoor layout). Only one `FloorPlan` per Branch is `active` at a time; `Table.floor`/`positionX`/`positionY`/etc. are always interpreted relative to the currently active FloorPlan. See DATABASE_SCHEMA.md for the justification of `FloorPlan` as a real table rather than fields on Table.

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
* Position is unique per active queue scope (branch + service window).

---

## Messaging Aggregate

### Root

Conversation

### Child Entities

* ConversationParticipant
* Message

### Responsibilities

* Customer–restaurant staff messaging (ADR-020)
* Optional linkage to `Reservation`
* Read receipts via `lastReadAt` on participants

### Policies

`ConversationPolicy` — only participants and authorized staff may read/send; customers cannot access other customers' threads.

---

## Invoice Entity (Billing)

Not a standalone aggregate root — owned by the **Subscription / Payment** bounded context. Generated from `Payment` success or subscription renewal (ADR-021). `Invoice` references `Files` for PDF storage.

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

### Root

Menu

### Child Entities

* MenuCategory
* MenuItem

---

## Review Aggregate

### Root

Review

### Child Entities

* ReviewImage
* RestaurantReply

---

## Subscription Aggregate

### Root

Subscription

### Child Entities

* SubscriptionPlan
* SubscriptionUsage

### Notes

* A Subscription belongs to exactly one **Organization**, not to a Restaurant (see ADR-011). All plan limits (`maxRestaurants`, `maxBranches`, `maxEmployees`, `maxMonthlyReservations`) are enforced against the Organization's aggregate usage across every Restaurant and Branch it owns, via `SubscriptionValidator`.
* `SubscriptionUsage` is recalculated incrementally as domain events occur (`RestaurantCreated`, `BranchCreated`, `EmployeeCreated`, `ReservationCreated`) rather than computed from a live `COUNT(*)` query on every write, to avoid turning limit-checking into a performance bottleneck at scale.

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
* MenuItem
* Review
* Offer
* Notification
* Subscription
* Payment
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

---

PhoneNumber

Validates formatting and country code.

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

NotificationDispatcher — resolves the correct `NotificationTemplate` for an event, in the recipient's `User.language`, before handing off to `NotificationProvider`.

SubscriptionValidator

AccountAnonymizationService — implements the anonymization mechanics defined in ADR-014; invoked by the `AnonymizeUserAccount` use case, never invoked implicitly by unrelated flows.

PricingCalculator

RestaurantSearchService — executes discovery queries per ADR-018: full-text and taxonomy filters in PostgreSQL for initial scale; optional external search index when restaurant count exceeds configured threshold. **Nearby** queries use branch `latitude`/`longitude`. **Comparison** returns a normalized DTO for a set of restaurant IDs (no separate aggregate).

WaitlistPromotionService — promotes the next eligible `ReservationWaitlistEntry` when a table slot opens or staff triggers manual promotion; creates `Reservation` in the same transaction as waitlist status update.

ConversationService — creates threads, validates participants, appends messages; publishes `MessageSent` for WebSocket fan-out.

AnalyticsCalculator

FileStorageService (Interface Only)

PaymentGateway (Interface Only)

NotificationProvider (Interface Only)

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
| `ReviewPolicy` | Create review (post-completion), owner reply |
| `SubscriptionPolicy` | Plan limits, feature gating |
| `AnalyticsPolicy` | Report access by role and scope |
| `ConversationPolicy` | Chat read/send, participant membership |
| `WaitlistPolicy` | Join queue, promote, cancel waitlist entry |

Policies compose `PermissionResolver` (RBAC) with **Ownership Rules** (resource-level checks).

## Ownership Rules

| Actor | Rule |
|---|---|
| Organization Owner | Full org-admin actions via `OrganizationMember.role`; operational actions require `Employee` record |
| Restaurant Owner | All branches of owned restaurant unless branch-restricted |
| Manager | Assigned branches; elevated operational permissions |
| Receptionist | Reservations and guest management within branch scope |
| Cashier | Payment-related actions within branch scope |
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

SubscriptionRepository

NotificationRepository

PaymentRepository

Repositories expose business-oriented operations rather than raw database access.

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

SubscriptionUpgraded

PaymentSucceeded

NotificationSent

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
* Party size (`guests`) must not exceed the referenced table's `capacity`; the availability search must only offer tables whose capacity is greater than or equal to the requested party size.
* A table cannot have overlapping confirmed reservations. This is enforced at two independent layers: an application-level advisory lock scoped to `(branch, table, timeslot)` at creation/approval time, and a database-level exclusion constraint as a safety net (see ADR-013).
* Two **pending** reservations for the same table and overlapping time window may both be created (since neither is yet confirmed), but only one may be approved; approving the first automatically rejects any other pending reservation whose time window overlaps the same table, with a system-generated note explaining the automatic rejection.
* Pending reservations have a configurable expiration period (`RestaurantSettings.pendingReservationTimeout`); an expired pending reservation transitions automatically to `Expired` via a scheduled BullMQ job and releases the table.
* A completed reservation cannot return to a pending state.
* A cancelled reservation cannot be approved.
* **Reservation modification/rescheduling:** a confirmed reservation's date, time, or party size may be changed only while the reservation is in `Pending` or `Approved` status, only up until the restaurant's configured `cancellationWindow` before the reservation time, and only if the new date/time/table combination independently passes the same availability and locking checks as a new reservation. Each successful reschedule is recorded in `ReservationHistory` with both the old and new values. Rescheduling within the cancellation window is rejected with `ReservationRescheduleWindowExpiredException`.
* **Cancellation window:** a reservation may be cancelled by the customer without restriction outside `RestaurantSettings.cancellationWindow` before its scheduled time; cancellations inside the window are still permitted (a customer can always cancel) but are flagged (`withinCancellationWindow: true` on the resulting `ReservationHistory` entry) so the restaurant may apply its own late-cancellation policy (e.g., a no-show-equivalent record) — the platform does not itself charge cancellation fees in v1; that is deferred to the Payments ADR (see DECISIONS.md Future Decisions).
* **No-show policy:** a restaurant may mark a confirmed reservation as `NoShow` only after its scheduled time has passed and only if the guest never arrived; a `ReservationNoShow` event is published and contributes to that customer's (`User` or `ReservationGuest`, matched by phone number when no `User` exists) no-show count. A configurable threshold (`SystemConfiguration.noShowThreshold`) may restrict a customer with excessive no-shows to phone-only or manager-approved reservations — the specific restriction mechanism is a Phase 7+ product decision, but the counting and event are defined now so the data exists when the policy is implemented.

---

## Tables

* Each table belongs to one branch.
* Table numbers are unique within a branch.
* Disabled tables cannot receive reservations.
* Tables under cleaning cannot be reserved.
* **Merged tables:** merging two or more tables creates a `TableMerged` event and marks all constituent tables as `Merged` with a shared `mergeGroupId`; the merge group behaves as a single reservable unit with combined capacity until explicitly split. A merge is rejected if any constituent table already has a confirmed or pending reservation whose time window has not yet passed — existing reservations must be resolved (cancelled, completed, or reassigned) before the tables they occupy can be merged.
* **Splitting** a merge group is rejected if the merge group itself has an active confirmed or pending reservation; the reservation must be completed, cancelled, or reassigned to one of the individual tables first. On successful split, each table returns to its individual capacity and independent reservability.

---

## Restaurants

* Each restaurant owns one or more branches, and belongs to exactly one Organization (see Organizations above).
* Restaurants must have an active subscription (at the Organization level) to access premium features.
* Suspended restaurants cannot receive new reservations. Existing confirmed reservations at a suspended restaurant remain valid and must still be honored (suspension blocks new bookings, it does not cancel existing commitments); restaurant staff retain access only to fulfil already-confirmed reservations, not to create new ones.
* **Subscription expiration with future reservations:** if an Organization's subscription lapses, its Restaurants transition to `Suspended` (per the rule above) rather than having their existing reservation data altered or deleted; reservations already booked continue to completion. Reactivating the subscription lifts the suspension without any data loss.
* **Branch deletion:** a Branch may only be soft-deleted if it has no `Pending` or `Approved` reservations with a future date/time; a Branch with future reservations must have them cancelled, completed, or migrated to another branch first. Soft-deleting a Branch cascades to soft-deleting its Tables but never its historical Reservations, which are immutable per the Soft Delete Policy in DATABASE_SCHEMA.md.

---

## Employees

* Employees belong to one restaurant.
* Permissions are role-based and may be extended individually.
* Deactivated employees cannot authenticate.
* **Employee branch rules:** an Employee with no `EmployeeBranchAssignment` records operates at restaurant-wide scope and may act on any of that restaurant's branches; an Employee with one or more assignments is restricted to exactly those branches and any action scoped to a different branch is rejected with `EmployeeBranchNotAssignedException`, regardless of role.
* **Employee permission inheritance:** an Employee's effective permission set is resolved as `(RolePermissions ∪ IndividualGrants) − IndividualRevocations`. Role-level permissions form the baseline; an individually-granted permission adds to that baseline; an individually-revoked permission removes a permission the role would otherwise confer. Revocations always take precedence over grants when both target the same permission on the same employee (an explicit revocation is a deliberate narrowing and must not be silently overridden by the role default). Permission resolution is performed by `PermissionResolver` (see Domain Services / Authorization) and is embedded in short-lived JWT claims at authentication time rather than recomputed from the database on every request, refreshed whenever a role or override changes (see NON_FUNCTIONAL_REQUIREMENTS.md's "never cache permission checks" rule, clarified: this refers to never trusting a long-lived cache as the source of truth across a role change, not to recomputing from Postgres on every single request).

---

## Reviews

* Reviews may only be created after a completed reservation.
* One reservation may produce only one review (enforced by a unique constraint on `Review.reservationId`).
* Restaurant owners may reply once to a review.

---

## Notifications

* Notifications are generated only after successful business actions.
* Delivery failures are retried through background jobs.
* Notification providers must be interchangeable.
* Notification content is resolved through a `NotificationTemplate` in the recipient's preferred language (`User.language`); if no translation exists for that language, the template's configured default-language version is used — a notification is never sent with a missing/blank body.

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

* Submit Review
* Reply to Review
* Delete Review

---

## Offers

* Create Offer
* Publish Offer
* Expire Offer

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
* Send Message
* Mark Conversation Read
* Close Conversation

---

## Billing

* Generate Invoice
* Issue Invoice
* Void Invoice

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
* Every payment belongs to a subscription or billable operation.
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

Exceptions should express business failures, not infrastructure failures.

---

# Anti-Corruption Layer

External services must never leak into the domain.

Adapters should translate between external APIs and internal models.

Examples:

OneSignal Adapter

Stripe Adapter

PayPal Adapter

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
* Payment Service
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
