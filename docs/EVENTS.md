# SYSTEM EVENTS

## Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

This document defines every domain event used across the platform.

Events are consumed by:

* Socket.IO
* BullMQ
* Notification Service
* Analytics
* Audit Logs
* Future Microservices

Events must be immutable.

Every event should include:

* Event ID
* Event Name
* Timestamp (UTC)
* Correlation ID
* Actor
* Resource ID
* Payload

---

# Organization Events

* OrganizationCreated
* OrganizationMemberInvited
* OrganizationMemberRoleChanged
* OrganizationMemberRemoved
* OrganizationOwnershipTransferred
* OrganizationSuspended

---

# Authentication Events

* UserRegistered
* UserVerified (alias: EmailVerified — same event, canonical name `UserVerified`)
* UserLoggedIn
* UserLoggedOut
* PasswordChanged
* PasswordResetRequested
* PasswordResetCompleted
* EmailVerified (retained for backward compatibility; prefer `UserVerified`)
* SessionCreated
* SessionRefreshed
* SessionRevoked

See AUTHENTICATION_ARCHITECTURE.md §10 for payloads and consumers.

---

# Authorization Events

* RoleAssigned
* PermissionGranted
* PermissionRevoked
* PermissionEscalationDetected

See AUTHORIZATION_ARCHITECTURE.md and EVENTS.md Security Events below.

---

# Security Events

Security events span Authentication and Authorization. Each includes: **producer**, **consumers**, **payload**, **trigger**.

| Event | Producer | Consumers | Trigger | Key payload fields |
|---|---|---|---|---|
| `SuspiciousLoginDetected` | `LoginUseCase` / auth infrastructure | Audit, Notification (future), Security monitoring | New device fingerprint + IP for known user | `userId`, `ipAddress`, `deviceFingerprint`, `previousIps[]` |
| `ImpossibleTravelDetected` | Auth infrastructure (geo IP) | Audit, Notification, `SecurityAlertRaised` | Login from country impossible given last login time/distance | `userId`, `fromCountry`, `toCountry`, `elapsedMinutes` |
| `TokenReplayDetected` | `RefreshSessionUseCase` | Audit, Notification, `SessionFamilyRevoked` | Superseded refresh token presented | `userId`, `tokenFamilyId`, `sessionId`, `ipAddress` |
| `SessionRevoked` | Logout / admin / security flows | Audit | Single `DeviceSession.revokedAt` set | `sessionId`, `userId`, `reason` |
| `SessionFamilyRevoked` | Refresh reuse handler | Audit, Notification | Entire token family compromised | `tokenFamilyId`, `userId`, `reason` |
| `AccountLocked` | `LoginUseCase` | Audit, Notification | Failed login threshold exceeded | `userId`, `lockedUntil`, `failedAttempts` |
| `AccountUnlocked` | Admin / auto-unlock job | Audit | Lock duration expired or admin unlock | `userId`, `unlockedBy` |
| `PasswordCompromised` | Security ops / reuse handler | Audit, Notification, force `sessionVersion` bump | Confirmed credential leak | `userId`, `source` |
| `PasswordReuseDetected` | `ChangePasswordUseCase` | Audit | New password matches history entry | `userId` |
| `BruteForceDetected` | Rate limiter / login attempt aggregator | Audit, WAF alert (future) | IP or identifier exceeds threshold | `identifier`, `ipAddress`, `attemptCount` |
| `PermissionEscalationDetected` | `PermissionResolver` / admin audit | Audit, `SecurityAlertRaised` | Unusual grant: sensitive permission to low role | `employeeId`, `permissionId`, `grantedBy` |
| `SecurityAlertRaised` | Security event aggregator | Platform admin dashboard, PagerDuty (future) | Any critical security event rollup | `severity`, `alertType`, `correlationId`, `details` |

### Standard event envelope (all security events)

```json
{
  "eventId": "uuid",
  "eventName": "TokenReplayDetected",
  "timestamp": "ISO-8601",
  "correlationId": "uuid",
  "actor": { "userId": "uuid", "actorType": "System" },
  "resourceId": "tokenFamilyId or sessionId",
  "payload": {}
}
```

**Rules:**

* Security events are never broadcast via Socket.IO to clients.
* Producers live in Authentication or Authorization modules only.
* All security events write to `AuditLogs` with `action` matching event name.

---

---

# Privacy Events

* UserDataExportRequested
* UserAccountDeletionRequested
* UserAccountDeletionCancelled
* UserAccountAnonymized

---

# Restaurant Events

* RestaurantCreated
* RestaurantUpdated
* RestaurantDeleted
* RestaurantActivated
* RestaurantSuspended

---

# Branch Events

* BranchCreated
* BranchUpdated
* BranchDeleted

---

# Employee Events

* EmployeeCreated
* EmployeeUpdated
* EmployeeDeleted
* EmployeeInvited
* EmployeeActivated

---

# Table Events

* TableCreated
* TableUpdated
* TableDeleted
* TableMerged
* TableSplit

`TableMoved` is deliberately not listed as a domain event class (Phase 6.2 architecture decision, TASKS.md) - Move Table produces an audit log entry only (`table.moved`), following the same direct-audit-write pattern already used elsewhere when no dedicated event class is warranted (e.g. `restaurant.settings.updated`). There are currently no consumers that require a dedicated `TableMovedEvent`. If a future phase (Reservations, Notifications, Analytics, etc.) needs one, it must be introduced through its own explicit architectural decision, not reintroduced silently.

`TableDisabled`/`TableEnabled`/`TableStatusChanged` are likewise deliberately not listed as domain event classes (Status Management architecture decision, TASKS.md). Status Management exposes status transitions through a single generic Domain Action, `POST /tables/{tableId}/status` - there are no separate Disable/Enable actions, since disabling and enabling are state transitions within the Table lifecycle rather than independent business capabilities, so `TableDisabled`/`TableEnabled` no longer correspond to any distinct capability at all. Every status transition produces a `table.status_changed` audit-log entry only. There are currently no consumers that require a dedicated event class. If a future phase needs one, it must be introduced through its own explicit architectural decision, not reintroduced silently.

---

# Reservation Events

* ReservationCreated
* ReservationPending
* ReservationApproved
* ReservationRejected
* ReservationCancelled
* ReservationRescheduled
* ReservationExpired
* ReservationCompleted
* ReservationNoShow
* ReservationUpdated

**Phase 7 pre-implementation decision note (2026-07-19):** unlike `TableMoved`/`TableDisabled`/`TableEnabled`/`TableStatusChanged` above, every event in this list becomes a real domain event class, not an audit-only direct write. That audit-only precedent applied specifically because Move Table and Status Management had no consumers yet - Reservation events already have named consumers documented in this file and `DOMAIN_MODEL.md` (Analytics, Notifications, WebSocket fan-out per Phase 8/9/14), so publishing them as proper domain events (via `AuditingEventPublisher`, the same mechanism every other consumed event already uses) is required from the first implementation, not deferred.

---

# Reservation Workflow

ReservationCreated

↓

ReservationPending

↓

ReservationApproved

↓

ReservationCompleted

Alternative paths

ReservationRejected

ReservationCancelled

ReservationExpired

ReservationNoShow

---

# Phone Reservation Events

* PhoneReservationCreated
* PhoneReservationCancelled
* PhoneReservationUpdated

---

# Walk-In Reservation Events

* WalkInReservationCreated
* WalkInReservationUpdated

---

# Waitlist Events

* WaitlistEntryCreated
* WaitlistEntryNotified
* WaitlistEntryPromoted
* WaitlistEntryExpired
* WaitlistEntryCancelled

---

# Operational Reservation Signals (ADR-019)

* ReservationReminderDue
* ReservationReminderSent
* GuestLateArrivalNotified
* TableReadyNotified

These are scheduled or staff-triggered signals consumed by `NotificationDispatcher` and WebSocket gateways.

---

# Review Events

* ReviewCreated
* ReviewUpdated
* ReviewDeleted
* RestaurantRepliedToReview

---

# Offer Events

* OfferCreated
* OfferUpdated
* OfferPublished
* OfferExpired
* OfferDeleted

---

# Notification Events

* NotificationCreated
* NotificationQueued
* NotificationSent
* NotificationDelivered
* NotificationRead
* NotificationFailed

---

# Subscription Events

* SubscriptionCreated
* SubscriptionRenewed
* SubscriptionCancelled
* SubscriptionExpired
* SubscriptionUpgraded
* SubscriptionDowngraded

---

# Payment Events

* PaymentInitiated
* PaymentAuthorized
* PaymentCaptured
* PaymentSucceeded
* PaymentFailed
* PaymentRefunded

---

# Invoice Events (ADR-021)

* InvoiceGenerated
* InvoiceIssued
* InvoicePaid
* InvoiceVoided

---

# Messaging Events (ADR-020)

* ConversationStarted
* MessageSent
* MessageRead
* ConversationClosed

WebSocket channel: `conversation:{conversationId}` — authorized participants only.

---

# File Events

* FileUploaded
* FileDeleted
* FileRestored

---

# Analytics Events

* ReservationStatisticsGenerated
* DailyReportGenerated
* MonthlyReportGenerated
* OccupancyCalculated

---

# Audit Events

All critical business actions should produce an audit event.

Examples

Reservation approved

Employee removed

Restaurant settings updated

Subscription upgraded

Payment completed

---

# WebSocket Broadcast Events

The following events are broadcast to connected clients in real time:

* reservation.created

* reservation.updated

* reservation.approved

* reservation.cancelled

* reservation.expired

* reservation.completed

* table.created

* table.updated

* table.deleted

* table.status.changed

* notification.created

* notification.read

* restaurant.updated

Clients should subscribe only to channels they are authorized to access.

## Room Naming Convention

Per ADR-015, broadcasts are scoped to Socket.IO rooms so the Redis Adapter can fan them out correctly across API instances while still respecting authorization. Rooms follow this naming pattern:

* `organization:{organizationId}` — organization-wide administrative events (e.g., subscription/billing changes), joined only by `OrganizationMember`s.
* `restaurant:{restaurantId}` — restaurant-wide events (e.g., restaurant settings updates), joined only by staff scoped to that restaurant.
* `branch:{branchId}` — table/floor-plan status changes for a specific branch, joined only by staff assigned to that branch (or restaurant-wide staff, per Employee Branch Rules in DOMAIN_MODEL.md).
* `reservation:{reservationId}` — updates for one specific reservation, joined by the customer who made it and the staff authorized for its branch.

A client joins a room only after the gateway verifies authorization for that specific resource — room names are never guessable substitutes for authorization checks.

---

# BullMQ Queue Events

Queues

NotificationQueue

ReservationQueue

ReminderQueue

AnalyticsQueue

CleanupQueue

ReportQueue

BackupQueue

Workers must process events asynchronously and be idempotent whenever possible.

---

# Event Naming Convention

Rules

* Use past tense.
* Use PascalCase for domain event names.
* Use dot notation for WebSocket channels.
* Event names must describe completed actions.

Examples

ReservationCreated

ReservationApproved

EmployeeInvited

TableStatusChanged

---

# Event Versioning

Every event should include:

* eventVersion
* eventTimestamp
* correlationId
* causationId

This ensures compatibility as the platform evolves.

---

# Future Integrations

The event system is designed to support future integration with:

* Apache Kafka
* RabbitMQ
* NATS
* AWS SNS/SQS
* Google Pub/Sub

without changing the domain layer.

---

# Best Practices

* Keep events immutable.
* Publish events only after successful database transactions.
* Avoid embedding sensitive information in event payloads.
* Design consumers to tolerate duplicate event delivery.
* Maintain backward compatibility when introducing new event versions.
