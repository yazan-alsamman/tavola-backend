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
* OrganizationOwnershipTransferred — documented since Phase 0; gains its first real producer under ADR-034 §6, implemented Phase 19.1 (narrow, PlatformAdmin-only emergency transfer; full self-service Organization management remains unbuilt and explicitly out of scope)
* OrganizationSuspended — documented since Phase 0; gains its first real producer under ADR-034 §4, implemented Phase 19.1 (PlatformAdmin-authorized; never cascades to `Restaurant.status`, ADR-034 §5)
* OrganizationReactivated (new, ADR-034 §4, implemented Phase 19.1)
* OrganizationDeleted (new, ADR-034 §4 — soft delete, reuses `Organization.deletedAt` — not implemented, out of Phase 19.1's scope)
* OrganizationRestored (new, ADR-034 §4 — not implemented, out of Phase 19.1's scope)

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
* RestaurantActivated — Owner/Admin-authorized since Phase 4; also PlatformAdmin-authorized under ADR-034 §3
* RestaurantSuspended — Owner/Admin-authorized since Phase 4; also PlatformAdmin-authorized under ADR-034 §3
* RestaurantRestored (new, ADR-034 §3 — no actor, Owner/Admin or PlatformAdmin, has ever had a restore capability before this; `RestaurantStatus` remains exactly `{Active, Suspended}`, no third "Archived" status introduced)

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

**Phase 10 architecture frozen (owner-approved) — see `TASKS.md`'s "Phase 10 — Reviews: Pre-implementation architecture decisions" for the full freeze.** None of these events are on the Phase 8 realtime broadcast allow-list or the Phase 9 `NotificationDispatcher` allow-list — both remain fail-closed/default-deny for every Review event; no code change was required to enforce this (the allow-lists are additive, not subtractive). `ReviewUpdated` is **removed** — Reviews are immutable after creation (no rating/comment edit endpoint exists), so no event class is ever needed for it.

* `ReviewCreated` — `{ reviewId, restaurantId, reservationId, userId, rating }`. Always a Customer actor (Reviews have no Employee/System creation path in Phase 10). Audited `actorType: 'User'`, `actorId: userId`. Payload deliberately excludes `comment` (event/audit is for attribution and future allow-list wiring, not content replication).
* `ReviewDeleted` — `{ reviewId, restaurantId, reservationId, deletedBy }`. `deletedBy` is a `User.id` in every case — either the owning Customer or an Organization Owner/Admin (both attribute as `actorType: 'User'` per the existing `AuditActorType` enum, which has no `OrganizationMember` variant; Owner/Admin actions have always logged as `'User'` platform-wide, e.g. `AddRestaurantGalleryImageUseCase`). Employees never delete Reviews in Phase 10, so no `Employee` attribution path exists for this event.
* `RestaurantRepliedToReview` — `{ reviewId, restaurantId, repliedByUserId }`. Always an Organization Owner/Admin `User.id` — no Employee reply path exists in Phase 10, so there is no dual-actor-id ambiguity to resolve here (unlike `TableMergedEvent`/`ReservationCancelledEvent`, which do need `TenantContextService.getActorType()` to disambiguate a User-or-Employee actor). Audited `actorType: 'User'`, `actorId: repliedByUserId`.

No Review event ever carries `ReservationGuest.phone`/`email`/`fullName` (moot in Phase 10 — guest reservations are not review-eligible at all), employee internal identifiers (no Employee attribution path exists), or storage/MinIO internals (bucket, object key). Public Customer identity in any Review-related response is `username` only — never real name/phone/email.

---

# Offer Events

**Phase 11 architecture frozen (owner-approved 2026-07-28), implemented and live-verified the same day — see `TASKS.md`'s "Phase 11 — Offers: Pre-implementation architecture decisions" and "Phase 11 — Offers: Implementation & Verification Report" for the full detail.** None of these events are on the Phase 8 realtime broadcast allow-list or the Phase 9 `NotificationDispatcher` allow-list — both remain fail-closed/default-deny for every Offer event, exactly like Review events (Phase 10 precedent); no code change is required to enforce this (the allow-lists are additive, not subtractive). **Phase 8 realtime impact: none. Phase 9 notification impact: none.**

* `OfferCreated` — `{ offerId, restaurantId, createdByUserId }`. Always an Organization Owner/Admin `User.id` — no Employee creation path exists. Audited `actorType: 'User'`, `actorId: createdByUserId`.
* `OfferUpdated` — `{ offerId, restaurantId, updatedByUserId }`. Reachable only while `status = Draft` — `Published`/`Expired` Offers are immutable, no update event can fire after publication.
* `OfferPublished` — `{ offerId, restaurantId, publishedByUserId }`. `Draft -> Published` only.
* `OfferExpired` — `{ offerId, restaurantId }`. `Published -> Expired` only, via the BullMQ-scheduled, CAS-guarded expiration job (`WHERE status = 'Published'`) — no authenticated actor. Audited `actorType: 'System'`, `actorId: null`.
* `OfferDeleted` — `{ offerId, restaurantId, deletedByUserId }`. Soft delete (`deletedAt`), reachable by Owner/Admin from any state (`Draft`/`Published`/`Expired`).

No Offer event carries a coupon redemption code, discount financial outcome, or customer identity — Offers have no customer-facing recipient/actor in Phase 11 (display-only; see `DATABASE_SCHEMA.md`'s Phase 11 freeze note).

---

# Menu Events

**Phase 18 architecture frozen (owner-approved 2026-08-02, ADR-031), ownership/availability/isFeatured corrected 2026-08-03 (ADR-032) — implemented 2026-08-03.** None of these events are on the Phase 8 realtime broadcast allow-list or the Phase 9 `NotificationDispatcher` allow-list — both remain fail-closed/default-deny, exactly like Review/Offer events; no code change was required to enforce this (the allow-lists are additive, not subtractive). **Phase 8 realtime impact: none. Phase 9 notification impact: none.** All twenty-seven events below are dual-actor, using `TenantContextService.getActorType()` to disambiguate exactly like `TableMergedEvent`/`ReservationCancelledEvent` (see Review Events above): Organization Owner/Admin → `actorType: 'User'`, `actorId` = `OrganizationMember.userId`; Employee holding `menu:manage` → `actorType: 'Employee'`, `actorId` = `Employee.id`. No `System`/BullMQ-driven Menu event exists (unlike `OfferExpired`) — every Menu mutation is a direct, synchronous, authenticated write.

* `MenuCreated` — `{ menuId, restaurantId, actorId }`. Menu creation for a Restaurant — **a Restaurant may own more than one Menu (ADR-032 supersedes the original `@@unique([restaurantId])` singleton constraint)**; the first Menu created for a Restaurant is auto-marked `isDefault` (no separate `MenuSetAsDefault` event fires for that implicit first-creation case).
* `MenuUpdated` — `{ menuId, restaurantId, actorId }`. `name`/`displayOrder` change — `active`/`isDefault` toggles use the dedicated events below, not this one. (`name` added at implementation time, 2026-08-03 — see `DATABASE_SCHEMA.md`'s Menu note.)
* `MenuActivated` — `{ menuId, restaurantId, actorId }`. `active: false -> true`.
* `MenuDeactivated` — `{ menuId, restaurantId, actorId }`. `active: true -> false`.
* `MenuSetAsDefault` — `{ menuId, restaurantId, actorId }`. **Added by ADR-032.** Marks this Menu as the Restaurant's Default Menu; atomically unmarks whichever Menu previously held `isDefault = true` in the same transaction — no separate "unset" event fires for the previous holder, mirroring how `Table`'s `isMergePrimary` reassignment (ADR-026) is a single event, not two.
* `MenuDeleted` — `{ menuId, restaurantId, actorId }`. Soft delete. **Added at implementation time (2026-08-03)** — not originally enumerated despite `Menu` being soft-deletable; the same CRUD-symmetry gap ADR-031 itself already flagged and filled for OptionGroup/Option/AddOn (see `DOMAIN_MODEL.md`'s Menu Management note), filled here for the same reason.
* `CategoryCreated` — `{ categoryId, menuId, restaurantId, actorId }`.
* `CategoryUpdated` — `{ categoryId, restaurantId, actorId }`. Covers name/description/image edits.
* `CategoryDeleted` — `{ categoryId, restaurantId, actorId }`. Soft delete (`deletedAt`).
* `CategoriesReordered` — `{ menuId, restaurantId, orderedCategoryIds, actorId }`. Whole-set bulk `displayOrder` replacement; the request is rejected before any event fires if `orderedCategoryIds` does not exactly match the Menu's current non-deleted Category set (no partial or foreign-ID reorders).
* `MenuItemCreated` — `{ menuItemId, categoryId, restaurantId, actorId }`.
* `MenuItemUpdated` — `{ menuItemId, restaurantId, actorId }`. Covers name/description/price/currency/preparationTime/spicyLevel/calories/allergens/dietaryLabels edits.
* `MenuItemDeleted` — `{ menuItemId, restaurantId, actorId }`. Soft delete.
* `MenuItemAvailabilityChanged` — `{ menuItemId, restaurantId, availabilityMode, actorId }`. Fires whenever `availabilityMode` changes as part of Update Item (no separate endpoint exists). Payload carries only the mode, not the schedule content — see `MenuItemAvailabilityWindowsReplaced` below for the actual `MenuItemAvailability` row changes (**corrected by ADR-032**: `scheduleJson` no longer exists).
* `MenuItemAvailabilityWindowsReplaced` — `{ menuItemId, restaurantId, windowCount, actorId }`. **Added by ADR-032.** Whole-set bulk replacement of a Menu Item's `MenuItemAvailability` rows, same contract as `CategoriesReordered`/`MenuItemsReordered`. Payload omits the actual day/time values — schedule content is operational configuration, not audit-relevant, matching the same reasoning `scheduleJson` was previously omitted under.
* `MenuItemFeatured` — `{ menuItemId, restaurantId, actorId }`. **Added by ADR-032.** `isFeatured: false -> true`.
* `MenuItemUnfeatured` — `{ menuItemId, restaurantId, actorId }`. **Added by ADR-032.** `isFeatured: true -> false`.
* `MenuItemsReordered` — `{ categoryId, restaurantId, orderedMenuItemIds, actorId }`. Same whole-set bulk-replacement contract as `CategoriesReordered`, scoped to one Category's Items.
* `OptionGroupCreated` — `{ optionGroupId, menuItemId, restaurantId, actorId }`.
* `OptionGroupUpdated` — `{ optionGroupId, restaurantId, actorId }`. Covers name/required/minSelections/maxSelections edits.
* `OptionGroupDeleted` — `{ optionGroupId, restaurantId, actorId }`. Soft delete.
* `OptionCreated` — `{ optionId, optionGroupId, restaurantId, actorId }`.
* `OptionUpdated` — `{ optionId, restaurantId, actorId }`. Covers name/priceModifier/active edits.
* `OptionDeleted` — `{ optionId, restaurantId, actorId }`. Soft delete.
* `AddOnCreated` — `{ addOnId, menuItemId, restaurantId, actorId }`.
* `AddOnUpdated` — `{ addOnId, restaurantId, actorId }`. Covers name/price/active edits.
* `AddOnDeleted` — `{ addOnId, restaurantId, actorId }`. Soft delete.

No Menu event carries customer identity — every actor is Owner/Admin/Employee; Menu read access by Customers is unauthenticated-or-lightly-authenticated public browsing with no write path, so no Customer-attributed event exists in this catalog.

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
| `MessageSent` | A — Push + In-App (Customer-only) | Phase 15.6 (Messaging) Owner Decision D6, added after this table's initial Phase 9 freeze — see `TASKS.md`'s Phase 15.6 Implementation & Verification Report. A Customer-sent or System-sent message never notifies anyone; only a Restaurant-side (`OrganizationMember`/`Employee`) sender's message notifies the conversation's Customer participant, resolved via `ConversationParticipantRepository.findCustomerParticipant`. |

`WaitlistEntryNotified` is not separately listed — it fires as a consequence of the `WaitlistEntryPromoted`-triggered notification's push outcome (only on `Accepted`), never a second independent trigger.

* **Read track:** `read: false → true` (one-way; `readAt` set atomically). Not published as a domain event in v1 — a read receipt has no broadcast value (see "Explicitly excluded from Phase 8 broadcast" above).
* **Push track:** `NotAttempted → Queued → { Accepted | Failed }`. `Accepted`/`Failed` are both terminal *as persisted values* (a successful BullMQ retry after an intermediate failure updates the row directly to `Accepted`, once — per-attempt detail is BullMQ's own job log, not the domain's concern). **There is deliberately no `Delivered` state or event** — OneSignal's synchronous Send API only proves provider acceptance, never actual on-device delivery (verified against current OneSignal documentation during the Phase 9 freeze); introducing a `Delivered` claim without a real delivery-receipt/webhook integration (not built in this freeze) would misrepresent what Tavola can actually prove.

The only Notification-specific **domain event** Phase 9 v1 defines is `NotificationCreated` — published once, when the row is persisted, consumed both by Phase 8's realtime hint (above) and by `AuditingEventPublisher` per the usual convention. Push-track transitions (`Accepted`/`Failed`) are recorded as column updates on the `Notification` row itself, not as separate published domain events — the row *is* the audit trail (queryable via its own `pushStatus`/`pushSentAt`/`pushFailedAt`/`pushFailureReason` columns), avoiding six near-duplicate event classes for what is really one row's lifecycle.

---

# Subscription Events

**Architecture frozen 2026-07-28 (ADR-027) — entitlement/access contract, not billing.** No `SubscriptionRenewed`/`SubscriptionUpgraded`/`SubscriptionDowngraded` — a plan change is one event regardless of whether the new plan is "bigger" or "smaller" (that distinction is a UI-level interpretation, not a domain fact); there is no renewal to signal since there is no billing cycle.

* SubscriptionAssigned — `{ subscriptionId, organizationId, planId }`. PlatformAdmin-initiated (initial assignment) or system-initiated (default plan at Organization creation, `actorType: 'System'`). Also used to resume a `Cancelled` subscription (assigning a plan, same or different, is the only path back to `Active` from `Cancelled`).
* SubscriptionPlanChanged — `{ subscriptionId, organizationId, oldPlanId, newPlanId }`. PlatformAdmin-initiated only; immediate, no `effectiveAt` scheduling.
* SubscriptionSuspended — `{ subscriptionId, organizationId }`. PlatformAdmin-initiated administrative pause.
* SubscriptionReactivated — `{ subscriptionId, organizationId }`. PlatformAdmin-initiated; resumes a `Suspended` subscription (only path back to `Active` from `Suspended` — distinct from `SubscriptionAssigned`'s role for `Cancelled`).
* SubscriptionCancelled — `{ subscriptionId, organizationId }`. PlatformAdmin-initiated terminal state; not automatically reactivated.
* SubscriptionExpired — `{ subscriptionId, organizationId }`. System-initiated (BullMQ-scheduled, CAS-guarded on `endsAt`, mirroring the Offer expiration precedent — Phase 11), `actorType: 'System'`.

No `PlanCreated`/`PlanUpdated` events — `SubscriptionPlan` rows are seed-managed (ADR-027), not dynamically created/edited through a runtime API in Phase 12.

---

# Customer Acquisition Events

**Architecture frozen 2026-08-04 (ADR-033) — financial source of truth, not billing.**

* CustomerAcquisitionRecorded — `{ acquisitionId, restaurantId, customerIdentityKey, feeAmount, feeCurrency, pricingRuleId, sourceReservationId }`. System-initiated, published in the same transaction as the triggering `Reservation`'s transition into `Approved` (§3, ADR-033).
* CustomerAcquisitionReversed — `{ acquisitionId, restaurantId, reversedBy, reversalReason }`. PlatformAdmin-initiated only, never automatic.
* CustomerAcquisitionManuallyRecorded — `{ acquisitionId, restaurantId, customerIdentityKey, feeAmount, feeCurrency, recordedBy, reason }`. PlatformAdmin-initiated, symmetric to Reversal — corrects an under-count (ADR-033 §11).
* AcquisitionPricingRuleActivated — `{ ruleId, scopeType, scopeId, feeType, effectiveFrom }`. PlatformAdmin-initiated. No `PricingRuleUpdated` event — rules are never edited in place (ADR-033 §15); a change is always a new `AcquisitionPricingRuleActivated` plus the superseded rule's `archivedAt` being set (no event for archiving alone — `archivedAt` is queryable directly on the row, the same "the row is the audit trail" precedent Notification push-tracking already established).

No `PaymentX`/`InvoiceX` event is introduced by this section, consistent with the Payment / Invoice Events section below.

---

# Platform Back Office Events

**Architecture frozen 2026-08-04 (ADR-034). Phase 19.1 subset implemented 2026-08-04** — Restaurant Suspend/Reactivate/Delete/Restore, Organization Suspend/Reactivate/Emergency Ownership Transfer, Account access control, Platform Admin account CRUD. `OrganizationDeleted`/`OrganizationRestored` remain frozen-but-not-yet-implemented — "complete Organization Management" was explicitly out of this phase's scope.

* RestaurantRestored (implemented), OrganizationReactivated (implemented), OrganizationDeleted (not implemented), OrganizationRestored (not implemented) — see Restaurant Events / Organization Events above.
* OrganizationOwnershipTransferred (implemented, Phase 19.1) — `{ organizationId, actorId, previousOwnerUserId, newOwnerUserId }`. First real producer, ADR-034 §6.
* PlatformAdminCredentialReset — `{ targetUserId, resetBy }`. PlatformAdmin-initiated; distinct from self-service `PasswordResetCompleted` — no OTP step, direct set by the admin, mirroring the trust model already established for Restaurant Owner provisioning (ADR-022 Decision #15).
* AccountLoginDisabled / AccountLoginEnabled — `{ targetUserId, actorId }`. PlatformAdmin-initiated; reuses the existing `User.status` field.
* PlatformAdminAccountCreated / PlatformAdminAccountRevoked — `{ platformAdminId, role, actorId }`. PlatformAdmin-initiated (finally makes `PlatformAdmin.revokedAt` reachable via an API — ADR-034 §10, FR-19.1).
* PlatformAdminAccountReactivated / PlatformAdminRoleChanged (implementation-scope additions, not in ADR-034's literal event list) — `{ platformAdminId, role, actorId }` (RoleChanged additionally carries `previousRole`). Symmetric with the Reactivate/Update capabilities this phase adds to the CRUD surface (see DATABASE_SCHEMA.md's Platform Admins note).

Force Logout reuses the existing `SessionFamilyRevoked` event unchanged in shape (already documented under Security Events) — no new event. `payload` gained one optional field, `actorId` (Phase 19.1) — set only when `reason = 'admin'`, since Force Logout is the first producer where the acting PlatformAdmin is a different identity than the target account; every existing self-service producer leaves it unset and is unaffected. The audit row, now correctly attributed via `actorType = PlatformAdmin` (ADR-034 §1, disambiguated by `reason`), is sufficient to distinguish an admin-forced logout from self-service.

---

# Payment / Invoice Events — Removed

TAVLA does not process payments in-app (Owner Decision, 2026-07-28). No `Payment*`/`Invoice*` events exist or are planned. See `TASKS.md`/`PROJECT_ROADMAP.md` Phase 13 and `DECISIONS.md` ADR-021 Disposition.

---

# Messaging Events (ADR-020, tenancy per ADR-030, Phase 15.6 decision note D9 in `DECISIONS.md`)

WebSocket channel: `conversation:{conversationId}` — authorized participants only (`RoomAuthorizationService.authorizeConversation`; Customer must be the conversation's `Customer` participant, Restaurant-side actor must pass the D15 Dual Actor check). Added to `RoomType` as the fifth room type — the "no Phase 8 rooms" carve-out below is now resolved for `conversation:{id}` specifically.

| Event | Trigger | Payload (`data`) |
|---|---|---|
| `ConversationStarted` | `StartConversation` use case commits | `{ conversationId, restaurantId, branchId, customerUserId, reservationId? }` |
| `MessageSent` | `SendMessage` use case commits | `{ conversationId, restaurantId, branchId?, messageId, senderType, senderUserId?, senderEmployeeId?, body, messageType, attachmentFileId? }` |
| `MessageRead` | `MarkConversationRead` use case commits | `{ conversationId, participantId, lastReadAt }` |
| `ConversationClosed` | `CloseConversation` use case commits | `{ conversationId, status, closedBy: 'Restaurant' \| 'Customer' }` |

All four follow the canonical realtime envelope (`{ eventId, eventType, occurredAt, aggregateType: 'Conversation', aggregateId, correlationId?, data }`) over the single `domain.event` Socket.IO event name, mapped via `realtime-event-mapping.ts` — no `staffRooms` fan-out beyond `conversation:{conversationId}` itself (staff join the same room once authorized).

---

# File Events (Future — Not Yet Implemented)

**Post-Audit Remediation correction (2026-08-02, M6): these three names were listed here with no payload contract and zero producers anywhere in the codebase — `src/modules/files` has no use-case layer of its own; `FileRecord` rows are created/deleted only as a side effect of other modules' use-cases (e.g. `AddReviewImageUseCase`, `SendMessageUseCase`'s attachment path, avatar/gallery upload).** Implementing these for real requires a product decision this remediation pass is not authorized to make on its own: the payload shape, whether "restore" is even a supported operation on `FileRecord` today, and which of the several upload call sites should publish. Left as a documented future item rather than wired in with an invented contract — do not treat as implemented.

* FileUploaded
* FileDeleted
* FileRestored

---

# Analytics Events

**Deferred — not authorized for Phase 14 v1 (ADR-028, architecture frozen 2026-07-28).** Phase 14 Analytics reads persisted state directly (`Controller → Query Use Case → AnalyticsQueryPort → PostgreSQL`); it does not publish or consume domain events. The names below are unimplemented future placeholders only — their presence in this document does not authorize building them, and none has a producer or consumer anywhere in the codebase. `OccupancyCalculated` specifically implies a capability (historical occupancy) that ADR-028 explicitly excluded from v1 because no historical capacity/topology snapshot exists to compute it from.

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

Subscription plan changed

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

No Phase 8 rooms: `waitlist:{id}`, `notification:{id}`.

**`conversation:{conversationId}` (Phase 15.6, DECISIONS.md D9)** — the room type this note previously deferred is now added, as a fifth `RoomType`, via the Phase 15.6 architecture decision note in `DECISIONS.md` (the "new architecture freeze" this section's original wording anticipated). Authorization: Customer only when they are the conversation's `Customer` participant; Employee/OrganizationMember only when they pass the Dual Actor check (D15) for the conversation's `restaurantId`/`branchId`.

Clients request typed subscriptions (`room.subscribe` / `room.unsubscribe` with `{ roomType, resourceId }`). The server constructs the canonical room name **after** authorization — room names are never guessable substitutes for authorization checks, and clients never join by supplying a raw room string as authorization input. Passive subscription is scope/ownership-based (no `realtime:*` / `websocket:*` / `reservations:read` permission slugs).

Event→room targeting and actor matrices are frozen in TASKS.md's "Phase 8 — WebSocket: Pre-implementation architecture decisions" note.

---

# BullMQ Queue Events

Queues

NotificationQueue

ReservationQueue

ReminderQueue

AnalyticsQueue — **deferred, not authorized for Phase 14 v1 (ADR-028).** No BullMQ worker or job exists for it; Phase 14 v1 is synchronous direct-read only. Listed as a future placeholder in case a later phase separately proves, with measured performance evidence, that an async rollup is needed.

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
