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

* UserRegistered — as of ADR-022 (2026-07-22), fires for administratively-provisioned Restaurant Owner accounts; customer account creation instead fires `CustomerRegistrationCompleted` (below).
* UserVerified (alias: EmailVerified — same event, canonical name `UserVerified`) — **no remaining producer as of ADR-022** (deprecation candidate alongside the email-verification subsystem itself, `AUTHENTICATION_ARCHITECTURE.md` §1.3).
* UserLoggedIn
* UserLoggedOut
* PasswordChanged
* PasswordResetRequested
* PasswordResetCompleted
* EmailVerified (retained for backward compatibility; prefer `UserVerified`) — same deprecation-candidate status as `UserVerified`.
* SessionCreated
* SessionRefreshed
* SessionRevoked
* CustomerPhoneVerificationRequested (new, ADR-022) — OTP sent via LightOTP (ADR-024); producer: the Start/Resend Domain Actions.
* CustomerPhoneVerified (new, ADR-022) — OTP verified successfully for a pending registration.
* CustomerRegistrationCompleted (new, ADR-022) — real customer `User` row created after password-setting; the customer-flow analogue of `UserRegistered`.
* CustomerPasswordResetRequested (new, ADR-022 Decision #16) — phone-based recovery OTP sent via LightOTP (ADR-024); the customer-flow analogue of `PasswordResetRequested`, never fired for Owner/staff (who keep the existing email event).
* CustomerPasswordResetCompleted (new, ADR-022 Decision #16) — password changed after successful OTP verification; the customer-flow analogue of `PasswordResetCompleted`.

Restaurant Owner provisioning (ADR-022 Decision #15) reuses the existing `UserRegistered` event unchanged — no new event is introduced for it.

See AUTHENTICATION_ARCHITECTURE.md §10 and §15 for payloads and consumers. Event payloads for the three new ADR-022 events are not fully specified in this documentation pass (implementation-phase detail); their names and triggers are frozen.

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
* TableMoved
* TableStatusChanged
* TableMerged
* TableSplit

**Phase 8 architecture freeze (approved 2026-07-24):** `TableMoved` and `TableStatusChanged` are now real domain event classes (the explicit future-phase decisions anticipated by the Phase 6.2 / Status Management notes below). **Phase 8 implementation shipped 2026-07-25** (see TASKS.md Phase 8 reports).

`TableMovedEvent` — published by Move Table (`POST /tables/:tableId/move`) post-operation through `EVENT_PUBLISHER`. Payload: `{ tableId, branchId, organizationId, oldFloorPlanId, newFloorPlanId, actorId }` (+ DomainEvent metadata/correlation). Audited as `table.moved` via `AuditingEventPublisher` (replacing the prior direct audit-only write).

`TableStatusChangedEvent` — published **only** for manual `Table.transitionStatus` via `ChangeTableStatusUseCase` (`POST /tables/:tableId/status`). Payload: `{ tableId, branchId, floorPlanId, organizationId, fromStatus, toStatus, actorId }` (+ metadata/correlation). Audited as `table.status_changed` via `AuditingEventPublisher`. **Not** emitted from Reservation-owned `Table.reserve()` / `Table.release()` (Approve, auto-approve, WaitlistConversion auto-approval, Approved Cancel, Complete, NoShow, Approved cross-table Reschedule) — those remain represented by their Reservation domain events; clients reconcile Table state via REST.

Historical Phase 6.2 note (retained): Move Table originally produced a `table.moved` audit-log entry only, with no domain event, because no consumer existed yet. Phase 8 creates that consumer (Live Tables / floor-plan sync).

Historical Status Management note (retained): Status transitions originally produced a `table.status_changed` audit-log entry only, with no domain event class (`TableDisabled`/`TableEnabled` remain non-events — there are no separate Disable/Enable capabilities). Phase 8 introduces `TableStatusChanged` as the single status-transition event for the existing Domain Action, Option A — narrow (manual transitions only).

**ADR-026 / Phase 6 Merge-Split architecture freeze (2026-07-25) — implemented, live-verified 2026-07-26 (see TASKS.md's Phase 6 Merge/Split Implementation & Verification Report):**

`TableMergedEvent` — published by Merge Tables (`POST /tables/merge`) through `EVENT_PUBLISHER` after a successful topology commit. Minimized operational payload (no guest/customer PII):

```
{
  mergeGroupId,
  primaryTableId,
  memberTableIds,
  branchId,
  floorPlanId,
  organizationId,
  effectiveCapacity,
  actorId
}
```

Audited as `table.merged`. Actor attribution: Employee → `actorType = Employee`, `actorId = Employee.id`; OrganizationMember Owner/Admin → existing Table event convention (`actorType = User`, `actorId = OrganizationMember.userId`, matching `TableMoved`/`TableStatusChanged`).

`TableSplitEvent` — published by Split Tables (`POST /tables/:tableId/split`) through `EVENT_PUBLISHER` after a successful topology commit. Payload:

```
{
  mergeGroupId,
  primaryTableId,
  memberTableIds,
  branchId,
  floorPlanId,
  organizationId,
  actorId
}
```

Audited as `table.split`. Same actor-attribution rules as `TableMerged`. **No Phase 9 NotificationDispatcher mappings; no push; no OneSignal** — realtime/audit domain events only.

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

`ReservationCreated` (Phase 7.1) and `ReservationApproved`/`ReservationRejected` (Phase 7.2, complete and live-verified 2026-07-23) are implemented as real domain event classes exactly per this note - `ReservationApprovedEvent`/`ReservationRejectedEvent` carry `automatic: boolean` (`false` for a manual Approve/Reject by an Employee, `true` for the auto-approval branch of Create Reservation / automatic rejection of an overlapping Pending reservation) and `approvedBy`/`rejectedBy: string | null` (the Employee id, or `null` for the automatic case) - audited with `actorType: 'Employee'` or `'System'` accordingly. `ReservationCreatedEvent.payload.createdBy` became `string | null` in Phase 7.5 (`null` for a Waitlist automatic/System promotion, `source: WaitlistConversion`) - `AuditingEventPublisher`'s attribution is three-way: `userId` set → `'User'`; `userId` null & `createdBy` set → `'Employee'`; both null → `'System'`.

`ReservationCancelled`/`ReservationRescheduled`/`ReservationCompleted`/`ReservationExpired`/`ReservationNoShow` (Phase 7.3 — Reservation Lifecycle, architecture frozen 2026-07-23, **implemented and live-verified 2026-07-23**) are real domain event classes per this note, published via the same `AuditingEventPublisher` mechanism. Actor attribution: `ReservationCancelledEvent`/`ReservationRescheduledEvent` carry the acting id (`cancelledBy`/`rescheduledBy: string`, the Customer's `userId` or the Employee's `employeeId` - Cancel/Reschedule are reachable by both); `ReservationCompletedEvent`/`ReservationNoShowEvent` carry `completedBy`/`markedBy: string` (always the acting Employee's id, staff-only actions); `ReservationExpiredEvent` carries no actor field at all (always `System`-attributed - the BullMQ-driven job has no authenticated HTTP actor). `ReservationCancelledEvent`'s payload additionally carries `withinCancellationWindow: boolean` (mirroring `ReservationHistory`'s own field). `ReservationRescheduledEvent`'s payload always carries `oldTableId`/`newTableId` (equal to each other when the table did not change, distinct when it did, mirroring `ReservationHistory`'s own new fields - see DATABASE_SCHEMA.md). `ReservationPending`/`ReservationUpdated` remain unimplemented and are not part of any currently-frozen scope.

**Phase 8 audit hygiene fix (shipped 2026-07-25):** `AuditingEventPublisher` now maps `ReservationCancelled`/`ReservationRescheduled`/`ReservationCompleted`/`ReservationExpired`/`ReservationNoShow` explicitly (`reservation.cancelled`/`reservation.rescheduled`/`reservation.completed`/`reservation.expired`/`reservation.no_show`), replacing the prior incorrect generic `auth.*` fallback. `Cancelled`/`Rescheduled` are reachable by both Customer and Employee; since their payload's `cancelledBy`/`rescheduledBy` id is ambiguous between the two (unlike `WaitlistEntryCancelledEvent`'s own explicit `cancelledByActorType` field), `actorType` is resolved via the new `TenantContextService.getActorType()`, reading the same request-scoped context the interceptor already binds — no change to the Phase 7.3 event payloads themselves. `Completed`/`NoShow` are always `actorType: 'Employee'` (staff-only actions); `Expired` is always `actorType: 'System'`, `actorId: null` (BullMQ-driven, no HTTP actor). Regression tests cover `action`/`actorType`/`actorId`/`targetType`/`targetId` for all 5, plus a guard proving the `auth.*` fallback is no longer reached for these events.

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

# Phone / Walk-In Reservation Events (superseded)

**Superseded by the unified Reservation Workflow events above (TASKS.md Phase 7.4 — Pre-implementation architecture decisions, decision #11, approved 2026-07-23).** `PhoneReservationCreated`/`PhoneReservationCancelled`/`PhoneReservationUpdated` and `WalkInReservationCreated`/`WalkInReservationUpdated` are **not** implemented as separate event classes. Phone (`source = Phone`) and Walk-In (`source = WalkIn`) reservations use the same `ReservationCreated`/`ReservationCancelled`/etc. events as Online reservations - `source` is a field on the unified event/reservation, not a discriminator for a parallel event hierarchy. Retained here, struck from active use, only as the historical record of the pre-Phase-7-freeze proposal.

---

# Waitlist Events

Implemented Phase 7.5 (Reservation Waitlist, architecture frozen 2026-07-24). Payload shapes below match `modules/waitlist/domain/events/waitlist.events.ts`; `AuditingEventPublisher` maps each to an `AuditLog` row.

* `WaitlistEntryCreated` — `{ entryId, restaurantId, branchId, userId: string | null, reservationGuestId: string | null, createdBy: string }`. `createdBy` always populated (Join always has a real Customer or Employee actor — System never Joins), mirroring `ReservationCreatedEvent`'s own always-populated pattern. Audited `actorType`: `userId !== null ? 'User' : 'Employee'`.
* `WaitlistEntryNotified` — `{ entryId, restaurantId, branchId, notifiedAt }`. **Reserved for Phase 9** (updated from the original "Phase 7.6" placeholder — Phase 7.6 implemented Reminder/Late-Arrival/Table-Ready only, per its own frozen scope, and deliberately did not invent a `Waiting -> Notified` production path) — the event class and the entity's `notify()` method exist, but no code path publishes it yet. **Activation semantics frozen 2026-07-25** (`TASKS.md`'s Phase 9 decision item 7): `notify()` is called, and `Waiting -> Notified` occurs, **only after the corresponding Phase 9 `Notification`'s push track resolves to `Accepted`** — never merely because a delivery job was queued, and never on `In-App` creation alone. A `Failed`/no-subscription push outcome leaves the entry `Waiting` (not `Notified`) — the durable in-app record still exists, but the waitlist-domain claim specifically requires push-level reach. A later successful retry fires `notify()` at that point, not retroactively. A guest-backed entry (`reservationGuestId` set, no `userId`) can never reach `Notified` in Phase 9 v1 (no recipient identity exists for a guest) and stays `Waiting` until promoted/cancelled/expired through its existing, unaffected paths — a disclosed v1 limitation. The existing `assertTransition` guard already rejects `Notified` as a target from any non-`Waiting` status, so an in-flight delivery attempt racing a `Converted`/`Cancelled`/`Expired` transition is already safely handled with no new guard needed.
* `WaitlistEntryPromoted` — `{ entryId, restaurantId, branchId, convertedReservationId, promotedBy: string | null }`. Mirrors `ReservationApprovedEvent`'s `approvedBy: string | null` pattern (not `ReservationCreatedEvent`'s always-populated shape) — `promotedBy` is the Employee id for manual promotion, `null` for automatic/System promotion. Successful conversion also emits `ReservationCreatedEvent` with `source = WaitlistConversion` (two aggregates, two events). Audited `actorType`: `promotedBy ? 'Employee' : 'System'`.
* `WaitlistEntryExpired` — `{ entryId, restaurantId, branchId }`. The BullMQ-driven expiration job has no authenticated actor — audited `actorType: 'System'`, `actorId: null`, exactly like `ReservationExpiredEvent`.
* `WaitlistEntryCancelled` — `{ entryId, restaurantId, branchId, cancelledBy: string, cancelledByActorType: 'User' | 'Employee' }`. Reachable by both the entry's own Customer and a branch-scoped Employee; `cancelledByActorType` is carried explicitly (rather than inferred) so audit attribution never has to guess from the entry's own ownership, since an Employee may cancel a User-owned entry.

---

# Operational Reservation Signals (ADR-019)

Implemented Phase 7.6 (Operational Signals, architecture frozen 2026-07-24) — domain/event side only, per that phase's own scope note. Payload shapes below match `modules/reservations/domain/events/reservation.events.ts`; `AuditingEventPublisher` maps each to an `AuditLog` row.

* `ReservationReminderDue` — `{ reservationId, restaurantId, branchId, reservationStartTime }`. Published by the BullMQ Reminder queue (`ReminderQueue`, scheduled at `reservationStartTime - RestaurantSettings.reservationReminderMinutesBefore` on Approval/auto-approval/promotion, re-timed on Reschedule, cancelled on Cancel/Complete/NoShow) — a no-op if the reservation is no longer `Approved` or its `reservationStartTime` no longer matches the job's own captured value (a stale job from before a reschedule). No authenticated actor — audited `actorType: 'System'`, `actorId: null`.
* `ReservationReminderSent` — **deferred to Phase 9; no class exists yet.** "Due" (scheduled, computed) and "Sent" (actual delivery confirmation from `NotificationProvider`) are deliberately distinct concepts, and Phase 7.6's explicit scope excludes notification delivery entirely (checklist item: "domain/event side only; actual notification delivery may be better sequenced alongside Phase 9"). **Semantics frozen 2026-07-25** (`TASKS.md`'s Phase 9 decision item 6): fires once per logical reminder (never once per channel) on successful **provider acceptance** of the reminder push — i.e. when the corresponding `Notification.pushStatus` transitions to `Accepted`. Never claims device-level delivery. Not published if the push was never attempted (`notificationOptIn = false`) or failed (`pushStatus = Failed`, after BullMQ's retry budget is exhausted) — the durable in-app `Notification` row still exists in every case; only the event's publication is conditioned on push acceptance specifically. Actor attribution: `System` (mirrors `ReservationReminderDue`/`GuestLateArrivalNotified`/`ReservationExpired`/`WaitlistEntryExpired`'s existing convention).
* `GuestLateArrivalNotified` — `{ reservationId, restaurantId, branchId, reservationStartTime, lateArrivalNotifiedAt }`. Published by the BullMQ Late-Arrival queue (`LateArrivalQueue`, scheduled at `reservationStartTime + RestaurantSettings.lateArrivalGraceMinutes`, same scheduling/cancellation lifecycle as the Reminder job above) after the repository's own single-column CAS (`markLateArrivalNotifiedIfEligible`, `WHERE status = 'Approved' AND lateArrivalNotifiedAt IS NULL`) succeeds — a `false` CAS result (already left `Approved`, or already notified) is a silent no-op, not an error, since this is a background sweep landing on a possibly-stale row. No authenticated actor — audited `actorType: 'System'`, `actorId: null`.
* `TableReadyNotified` — `{ reservationId, restaurantId, branchId, reservationStartTime, tableReadyNotifiedAt, markedBy: string }`. Staff-initiated only (`POST /reservations/:id/table-ready`, `reservations:tableready`, branch-scoped) — not a scheduled job. `status` remains `Approved`; no `Table` operation and no `ReservationHistory` row (this is an informational front-of-house signal, not a status transition). A `false` CAS result here (`markTableReadyNotifiedIfEligible`) is a genuine staff-facing 400 (`InvalidReservationStatusTransitionException`), not a silent no-op — the direct HTTP caller expects to be told. Audited `actorType: 'Employee'`, `actorId: markedBy`.

`Reservation.reschedule()` resets both `lateArrivalNotifiedAt` and `tableReadyNotifiedAt` to `null` unconditionally (safe for a `Pending` reschedule too, since both are already `null` there) — `RescheduleReservationUseCase` re-times both BullMQ jobs to match whenever the result is `Approved`.

These are scheduled (Reminder, Late-Arrival) or staff-triggered (Table Ready) signals consumed by `NotificationDispatcher` (Phase 9, implemented 2026-07-25) and WebSocket gateways (**Phase 8, implemented 2026-07-25** — broadcasts these domain events to authorized staff/reservation rooms as "Live Notifications" fan-out; does not perform notification delivery) — Phase 7.6 only publishes the domain events/audit rows themselves.

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

**Phase 9 (2026-07-25) — supersedes the placeholder list this section previously carried; see `TASKS.md`'s Phase 9 decisions items 4/5 for full reasoning.** Implemented 2026-07-25. `Notification` (the durable row itself, `DATABASE_SCHEMA.md`) tracks two independent state tracks directly as columns, not as a chain of six discrete lifecycle events:

## Event → notification allow-list (v1)

Explicit, not inferred from event names — no event outside this list produces a Phase 9 notification (`TASKS.md`'s Phase 9 decision item 17, the authoritative source of this table):

| Event | Classification | Reason |
|---|---|---|
| `ReservationApproved` | A — Push + In-App | Core transactional confirmation; Customer needs to know even if the app isn't open |
| `ReservationCancelled` | A — Push + In-App | A cancellation the Customer didn't initiate themselves is exactly the case push exists for |
| `ReservationRescheduled` | A — Push + In-App | Same reasoning, staff-initiated case especially |
| `ReservationReminderDue` | A — Push + In-App | This is the entire product reason `ReservationReminderSent` exists |
| `TableReadyNotified` | A — Push + In-App | Time-sensitive, staff-initiated, Customer benefits from a push even if the app is backgrounded |
| `WaitlistEntryPromoted` | A — Push + In-App | This is the trigger for `WaitlistEntryNotified`'s activation |
| `ReservationNoShow` | B — In-App only | Not a "good news, check your phone now" event from the Customer's own perspective |
| `GuestLateArrivalNotified` | D — no Phase 9 notification | Staff-facing operational signal, not Customer-facing (owner-confirmed) |
| `ReservationExpired` | D — no Phase 9 notification | Low-salience event; no requirement supports notifying about it (owner-confirmed) |

`WaitlistEntryNotified` is not separately listed — it fires as a consequence of the `WaitlistEntryPromoted`-triggered notification's push outcome (only on `Accepted`), never a second independent trigger.

* **Read track:** `read: false → true` (one-way; `readAt` set atomically). Not published as a domain event in v1 — a read receipt has no broadcast value (see "Explicitly excluded from Phase 8 broadcast" above).
* **Push track:** `NotAttempted → Queued → { Accepted | Failed }`. `Accepted`/`Failed` are both terminal *as persisted values* (a successful BullMQ retry after an intermediate failure updates the row directly to `Accepted`, once — per-attempt detail is BullMQ's own job log, not the domain's concern). **There is deliberately no `Delivered` state or event** — OneSignal's synchronous Send API only proves provider acceptance, never actual on-device delivery (verified against current OneSignal documentation during the Phase 9 freeze); introducing a `Delivered` claim without a real delivery-receipt/webhook integration (not built in this freeze) would misrepresent what Tavola can actually prove.

The only Notification-specific **domain event** Phase 9 v1 defines is `NotificationCreated` — published once, when the row is persisted, consumed both by Phase 8's realtime hint (above) and by `AuditingEventPublisher` per the usual convention. Push-track transitions (`Accepted`/`Failed`) are recorded as column updates on the `Notification` row itself, not as separate published domain events — the row *is* the audit trail (queryable via its own `pushStatus`/`pushSentAt`/`pushFailedAt`/`pushFailureReason` columns), avoiding six near-duplicate event classes for what is really one row's lifecycle.

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

**Phase 8, implemented 2026-07-25** (architecture frozen 2026-07-24; see TASKS.md's Phase 8 Implementation & Verification Report for full test/Docker/live-verification evidence). WebSocket is a projection/fan-out layer over committed domain events. REST remains the command surface and the authoritative state source. Delivery is best-effort (duplicates tolerated; no durable replay / exactly-once / cross-instance ordering guarantee). Clients reconcile via REST after reconnect.

Broadcasts use one canonical Socket.IO server event name: **`domain.event`**, with `eventType` (the DomainEvent's PascalCase `eventName`) inside a dedicated realtime envelope:

```
{ eventId, eventType, occurredAt, aggregateType, aggregateId, correlationId?, data }
```

`eventId` is `DomainEvent.eventId`. `data` is a PII-minimized projection (no raw ReservationGuest phone/email/fullName in generic broadcasts).

## Phase 8 allow-list (unknown events are NOT broadcast)

* ReservationCreated, ReservationApproved, ReservationRejected, ReservationCancelled, ReservationRescheduled, ReservationCompleted, ReservationExpired, ReservationNoShow
* WaitlistEntryCreated, WaitlistEntryPromoted, WaitlistEntryExpired, WaitlistEntryCancelled
* ReservationReminderDue, GuestLateArrivalNotified, TableReadyNotified
* TableCreated, TableUpdated, TableDeleted, TableStatusChanged, TableMoved
* TableMerged, TableSplit — **ADR-026 allow-list addition (architecture frozen 2026-07-25; implemented, live-verified 2026-07-26).** Broadcast to existing staff-visible `restaurant:{restaurantId}` + `branch:{branchId}` rooms only (same pattern as `TableMoved`/`TableStatusChanged`). Aggregate id = `primaryTableId`. No floor-plan room exists in Phase 8; do not invent one. Customer `reservation:{id}` rooms do **not** receive topology events. Realtime staff payload follows minimized projection of the domain event; `actorId` may be included because `TableMoved`/`TableStatusChanged` staff payloads already spread the full event payload (including `actorId`).
* RestaurantCreated, RestaurantUpdated, RestaurantDeleted, RestaurantActivated, RestaurantSuspended
* BranchCreated, BranchUpdated, BranchDeleted

**Phase 9 freeze additions (frozen 2026-07-25, `TASKS.md`'s Phase 9 decision item 1 — implemented 2026-07-25, additive only, does not redesign Phase 8):**

* `WaitlistEntryNotified` — once Phase 9 gives it a real production publisher (see the Waitlist Events section below), it broadcasts to the same staff `restaurant`/`branch` rooms as its three siblings (`WaitlistEntryCreated`/`Promoted`/`Expired`/`Cancelled`), using the identical staff-only payload pattern. **Requires an additive one-line change to `realtime-event-mapping.ts`'s existing Waitlist `instanceof` OR-chain during Phase 9 implementation** — the event class is currently excluded from that chain (default-deny), so it will **not** broadcast until that specific line is added; this is a Phase 9 implementation task, not something Phase 8's already-shipped code does automatically.
* `NotificationCreated` (new) — broadcasts **only** to the existing `reservation:{reservationId}` room, and only when the source event that produced the `Notification` carries a `reservationId` (see the Phase 9 event→notification allow-list, "Notification Events" section below); minimized payload `{ notificationId, type }` only, never `title`/`body`. **No new room type is introduced** — Phase 8's frozen "exactly four rooms" contract is unchanged. Requires a new, additive mapping branch in `realtime-event-mapping.ts` during Phase 9 implementation, following the same pattern `TableStatusChanged`/`TableMoved` already established for adding a new allow-listed event without altering the gateway/room/auth architecture.

## Explicitly excluded from Phase 8 broadcast

* ReservationUpdated — superseded by ReservationRescheduled; do not broadcast a generic updated event
* ReservationPending — unimplemented legacy name
* `notification.read` — a read receipt has no realtime fan-out value to anyone but the reader's own already-open client, which already knows it just read the notification; not broadcast
* Authentication / security events — never broadcast via Socket.IO (see Security Events section)

**Historical note (superseded by ADR-026 allow-list above):** earlier Phase 8 text excluded `TableMerged` / `TableSplit` because Merge/Split was deferred. Those events are now architecture-frozen for realtime allow-listing; production broadcast code remains unimplemented until Merge/Split implementation authorization.

Phase 8 "Live Notifications" means realtime fan-out of already-existing domain/operational signals (e.g. ReminderDue / LateArrival / TableReady) to authorized connected clients — **not** the Phase 9 Notification aggregate's persistence, delivery providers, or delivery-confirmation events (`ReservationReminderSent`). The one exception, `NotificationCreated` above, is a thin realtime *hint* that a durable row was created — REST/the database remains authoritative and a missed hint never means a lost notification (Phase 9 decision item 1).

## Room Naming Convention

Per ADR-015 and the Phase 8 freeze, broadcasts are scoped to Socket.IO rooms so the Redis Adapter can fan them out correctly across API instances while still respecting authorization. Phase 8 rooms are exactly:

* `organization:{organizationId}` — organization-wide events; OrganizationMember Owner/Admin of that organization only.
* `restaurant:{restaurantId}` — restaurant-scoped events; Employee with matching restaurant scope, or OrganizationMember whose org owns the restaurant.
* `branch:{branchId}` — table/floor-plan/reservation/waitlist/ops signals for a branch; Employee per existing branch-assignment semantics, or OrganizationMember via Branch→Restaurant→org.
* `reservation:{reservationId}` — updates for one reservation; Customer only when `reservation.userId === authenticated User.id` (guest-backed Phone/WalkIn/WaitlistConversion with `userId === null` → Customer DENY); Employee when the reservation's branch is in staff scope; OrganizationMember when the reservation's restaurant is in their org.

No Phase 8 rooms: `waitlist:{id}`, `notification:{id}`, `conversation:{id}` (ADR-020 / Phase 15.6).

Clients request typed subscriptions (`room.subscribe` / `room.unsubscribe` with `{ roomType, resourceId }`). The server constructs the canonical room name **after** authorization — room names are never guessable substitutes for authorization checks, and clients never join by supplying a raw room string as authorization input. Passive subscription is scope/ownership-based (no `realtime:*` / `websocket:*` / `reservations:read` permission slugs).

Event→room targeting and actor matrices are frozen in TASKS.md's "Phase 8 — WebSocket: Pre-implementation architecture decisions" note.

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

**Phase 9 freeze note (2026-07-25, `TASKS.md` decision item 10):** `NotificationQueue` is reserved exclusively for Phase 9 **delivery** work (persisted `Notification` → `NotificationProvider` → OneSignal adapter). It is explicitly separate from `ReminderQueue`/`LateArrivalQueue` (Phase 7.6, implemented), which own only *scheduling* (computing *when* a signal is due) — those queues are never modified to call `NotificationProvider` directly; they continue publishing the same `ReservationReminderDue`/`GuestLateArrivalNotified` domain events unchanged, which a new Phase 9 `NotificationDispatcher` subscribes to. Implemented 2026-07-25.

Workers must process events asynchronously and be idempotent whenever possible.

---

# Event Naming Convention

Rules

* Use past tense.
* Use PascalCase for domain event names.
* WebSocket **room** names use the ADR-015 pattern (`organization:{id}`, `restaurant:{id}`, `branch:{id}`, `reservation:{id}`).
* WebSocket **server emit channel** for domain fan-out is the single canonical name `domain.event` (Phase 8 freeze); the payload's `eventType` carries the PascalCase domain event name. Do not create an unbounded Socket.IO channel namespace per domain event.
* Event names must describe completed actions.

Examples

ReservationCreated

ReservationApproved

EmployeeInvited

TableStatusChanged

TableMoved

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
