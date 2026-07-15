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

Stores customer accounts.

Fields

* id (UUID)
* firstName
* lastName
* email
* phone
* passwordHash
* avatarId
* language
* preferredCurrency
* notificationOptIn (default `true`) — opt in to transactional/functional notifications
* marketingOptIn (default `false`) — opt in to marketing communications; defaults to opted-out per GDPR
* status (`Pending`, `Active`, `Suspended`, `Locked`, `Deleted`, `Anonymized`) — see AUTHENTICATION_ARCHITECTURE.md §3
* emailVerified
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

* email (unique — enforced at the database level; see AUTHENTICATION_ARCHITECTURE.md §1.2 and ADR-014's anonymization placeholder mechanism, which is what keeps a global unique constraint compatible with "unique among non-anonymized users")
* phone

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
* autoApproval (boolean)
* timezone
* defaultCurrency
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

Deferred to Phase 5 (not built in Phase 4.3): `branchId` nullable FK, branch-level override rows, composite `(branchId, dayOfWeek)` index.

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
* composite (latitude, longitude) — supports bounding-box and distance queries for nearby-restaurant search (ADR-018); consider `GiST` index on `point(longitude, latitude)` when query volume warrants (Phase 15+)

Notes

* `countryCode` and `currency` are owned at this level, not the Restaurant level (see DOMAIN_MODEL.md Money/Currency Ownership). If `currency` is null, the application falls back to `Restaurant Settings.defaultCurrency`.
* Geo coordinates are authoritative for **nearby restaurant** queries at branch granularity (a restaurant with multiple branches appears once per qualifying branch).

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

---

## Restaurant Tables

Each branch owns multiple tables.

Fields

* id
* branchId
* floorPlanId
* tableNumber
* capacity
* floor
* positionX
* positionY
* width
* height
* rotation
* shape
* layer
* indoor
* vip
* smoking
* status
* mergeGroupId (nullable)
* createdAt
* updatedAt
* deletedAt

Indexes

* branchId
* status
* mergeGroupId
* composite unique (branchId, tableNumber) — table numbers are unique within a branch

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
* reservationEndTime
* guests
* status
* source
* notes
* createdBy
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

Indexes

* reservationDate
* tableId
* branchId
* status
* composite (branchId, reservationDate, status) — the primary availability-search query filters by branch and date and excludes cancelled/expired reservations; this composite index directly serves that query without a full scan
* composite (tableId, reservationDate, reservationStartTime) — supports the conflict-check query executed inside the advisory-locked transaction (ADR-013) that verifies no overlapping reservation exists for a specific table before insert
* exclusion constraint EXCLUDE USING gist (tableId WITH =, tstzrange(reservationStartTime, reservationEndTime) WITH &&) WHERE status NOT IN ('Cancelled', 'Expired', 'Rejected') — the database-level safety net from ADR-013; requires the `btree_gist` extension

Notes

* Rescheduling a reservation updates the existing row in place (date/time/guests) rather than creating a new row, so a single `Reservation.id` remains stable for a customer across a reschedule; the full before/after values are captured in `Reservation History` instead. `rescheduledFromReservationId` is therefore reserved for a possible future "reschedule as a new booking" flow and is nullable/unused until such a flow is introduced — not required for the standard in-place reschedule described in DOMAIN_MODEL.md.

---

## Reservation Guests

Purpose

Represents the person a reservation is for when no registered User account exists (phone reservations, walk-ins). Personal data here is subject to the same anonymization rules as the User table (see ADR-014).

Fields

* id (UUID)
* fullName
* phone
* email (nullable)
* anonymizedAt (nullable)
* createdAt
* updatedAt

Indexes

* phone

---

## Reservation History

Stores every reservation state transition and modification.

Fields

* id (UUID)
* reservationId
* oldStatus
* newStatus
* oldReservationDate (nullable — populated on reschedule)
* oldReservationStartTime (nullable — populated on reschedule)
* newReservationDate (nullable — populated on reschedule)
* newReservationStartTime (nullable — populated on reschedule)
* withinCancellationWindow (boolean, nullable — populated on cancel/reschedule)
* changedBy
* changedAt
* reason

Indexes

* reservationId

---

## Reservation Waitlist Entries

Guests who cannot be seated immediately join a branch-scoped waitlist (ADR-019). Distinct from `Reservations` — no table assignment until promoted.

Fields

* id (UUID)
* organizationId
* restaurantId
* branchId
* userId (nullable — registered customer)
* reservationGuestId (nullable — phone/walk-in guest; exactly one of `userId` or `reservationGuestId` required)
* partySize
* preferredDate (nullable — date-only preference)
* preferredTimeFrom (nullable)
* preferredTimeTo (nullable)
* status (`Waiting`, `Notified`, `Converted`, `Expired`, `Cancelled`)
* position (integer — queue order within branch for a given service window; recomputed on promotion/cancel)
* convertedReservationId (nullable — set when promoted to `Reservations`)
* notifiedAt (nullable)
* expiresAt
* notes (nullable)
* createdAt
* updatedAt
* deletedAt

Indexes

* organizationId
* branchId
* status
* composite (branchId, status, position)
* composite (branchId, preferredDate, status)
* userId
* reservationGuestId

Constraints

* CHECK: (`userId` IS NOT NULL AND `reservationGuestId` IS NULL) OR (`userId` IS NULL AND `reservationGuestId` IS NOT NULL)

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

Fields

* id (UUID)
* userId
* type
* templateId
* title
* body
* read
* sentAt
* createdAt

Indexes

* userId
* composite (userId, read) — serves the common "unread notifications for this user" query

---

## Notification Templates

Purpose

Provides locale-aware notification content, resolved by `NotificationDispatcher` (see DOMAIN_MODEL.md). Justification: without a template entity, translated notification copy would have to live in application code, making it impossible for non-developers to manage content and impossible to add a language without a deployment.

Fields

* id (UUID)
* eventType (e.g., `ReservationApproved`, `ReservationCancelled`)
* language
* channel (`Push`, `Email`, `InApp`, `SMS`)
* subject (nullable — applies to Email)
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
