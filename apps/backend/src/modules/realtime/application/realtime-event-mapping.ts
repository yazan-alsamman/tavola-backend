import { DomainEvent } from '@shared/domain/base/domain-event.base';
import {
  GuestLateArrivalNotifiedEvent,
  ReservationApprovedEvent,
  ReservationCancelledEvent,
  ReservationCompletedEvent,
  ReservationCreatedEvent,
  ReservationExpiredEvent,
  ReservationNoShowEvent,
  ReservationRejectedEvent,
  ReservationRescheduledEvent,
  ReservationReminderDueEvent,
  TableReadyNotifiedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import {
  WaitlistEntryCancelledEvent,
  WaitlistEntryCreatedEvent,
  WaitlistEntryExpiredEvent,
  WaitlistEntryNotifiedEvent,
  WaitlistEntryPromotedEvent,
} from '@modules/waitlist/domain/events/waitlist.events';
import { NotificationCreatedEvent } from '@modules/notifications/domain/events/notification.events';
import {
  TableCreatedEvent,
  TableDeletedEvent,
  TableMergedEvent,
  TableMovedEvent,
  TableSplitEvent,
  TableStatusChangedEvent,
  TableUpdatedEvent,
} from '@modules/tables/domain/events/table.events';
import {
  RestaurantActivatedEvent,
  RestaurantCreatedEvent,
  RestaurantDeletedEvent,
  RestaurantSuspendedEvent,
  RestaurantUpdatedEvent,
} from '@modules/restaurants/domain/events/restaurant.events';
import {
  BranchCreatedEvent,
  BranchDeletedEvent,
  BranchUpdatedEvent,
} from '@modules/branches/domain/events/branch.events';
import {
  ConversationClosedEvent,
  ConversationStartedEvent,
  MessageReadEvent,
  MessageSentEvent,
} from '@modules/messaging/domain/events/messaging.events';
import { RoomType, buildCanonicalRoom } from './room';

/** Phase 8 §17 — the one canonical Socket.IO channel every envelope emits on. */
export const REALTIME_CHANNEL = 'domain.event';

/**
 * Resolves data a mapping entry needs but that isn't present on the event's
 * own payload - today, only Table events (`TableEventPayload`/
 * `TableStatusChangedEventPayload`/`TableMovedEventPayload`) carry
 * `branchId`/`organizationId` but not `restaurantId`, while Phase 8 §14's
 * frozen matrix requires the `restaurant:{id}` room for every Table event.
 * `RealtimeEventPublisher` supplies the real implementation (backed by
 * `BranchRepository`, already-existing infrastructure - no new dependency);
 * a lookup failure here just means those events broadcast to fewer rooms
 * than intended, never that the caller's business operation fails
 * (Phase 8 §3's "broadcast failure must never be rethrown" contract covers
 * this too since the mapper itself runs inside `RealtimeEventPublisher`'s
 * try/catch).
 */
export interface RealtimeRoomResolutionContext {
  resolveRestaurantIdForBranch(branchId: string): Promise<string | null>;
}

export interface RealtimeMapping {
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Organization/restaurant/branch rooms - all receive the identical staff-safe payload. */
  readonly staffRooms: readonly string[];
  readonly staffPayload: Record<string, unknown>;
  /** Only set for the events Phase 8 §14 routes into a `reservation:{id}` room. */
  readonly reservationRoom: string | null;
  readonly customerPayload: Record<string, unknown> | null;
}

function org(organizationId: string): string {
  return buildCanonicalRoom(RoomType.Organization, organizationId);
}
function restaurant(restaurantId: string): string {
  return buildCanonicalRoom(RoomType.Restaurant, restaurantId);
}
function branch(branchId: string): string {
  return buildCanonicalRoom(RoomType.Branch, branchId);
}
function reservation(reservationId: string): string {
  return buildCanonicalRoom(RoomType.Reservation, reservationId);
}
function conversation(conversationId: string): string {
  return buildCanonicalRoom(RoomType.Conversation, conversationId);
}
function user(userId: string): string {
  return buildCanonicalRoom(RoomType.User, userId);
}

/** Strips server-internal actor identifiers a Customer never needs (Phase 8 §15/§19). */
function omit<T extends object, K extends keyof T>(
  payload: T,
  keys: readonly K[],
): Record<string, unknown> {
  const result = { ...payload } as Record<string, unknown>;
  for (const key of keys) {
    delete result[key as string];
  }
  return result;
}

/**
 * Phase 8 §4/§8/§13/§14/§15/§18 — the single point implementing the frozen
 * allow-list, event -> room matrix, and audience-safe projections. Returns
 * `null` for any event not on the allow-list (default-deny, per §4 "unknown
 * events are NOT broadcast") - deliberately an `instanceof` dispatch chain,
 * mirroring `AuditingEventPublisher.toAuditEntry`'s own established
 * convention in this codebase, not a name-keyed lookup table.
 */
export async function mapDomainEventForRealtime(
  event: DomainEvent,
  ctx: RealtimeRoomResolutionContext,
): Promise<RealtimeMapping | null> {
  if (event instanceof ReservationCreatedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['userId', 'reservationGuestId', 'createdBy']),
    };
  }

  if (event instanceof ReservationApprovedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['approvedBy']),
    };
  }

  if (event instanceof ReservationRejectedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['rejectedBy']),
    };
  }

  if (event instanceof ReservationCancelledEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['cancelledBy']),
    };
  }

  if (event instanceof ReservationRescheduledEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['rescheduledBy']),
    };
  }

  if (event instanceof ReservationCompletedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['completedBy']),
    };
  }

  if (event instanceof ReservationNoShowEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['markedBy']),
    };
  }

  if (event instanceof ReservationExpiredEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: { ...p },
    };
  }

  // ReservationReminderDue / GuestLateArrivalNotified: staff rooms only, no
  // reservation room (Phase 8 §14's matrix - these are staff operational
  // signals, not customer-facing state changes).
  if (event instanceof ReservationReminderDueEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  if (event instanceof GuestLateArrivalNotifiedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  if (event instanceof TableReadyNotifiedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Reservation',
      aggregateId: p.reservationId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: reservation(p.reservationId),
      customerPayload: omit(p, ['markedBy']),
    };
  }

  // Waitlist lifecycle: staff rooms only (Phase 8 §14 - "not customer-room
  // broadcasts in Phase 8"), full payload (ids only, no guest PII).
  // WaitlistEntryNotified (Phase 9, architecture frozen 2026-07-25) joins
  // this OR-chain now that a real production publisher exists
  // (`ProcessNotificationDeliveryUseCase`) - identical staff-only payload
  // pattern as its three siblings (EVENTS.md's Phase 9 broadcast note).
  if (
    event instanceof WaitlistEntryCreatedEvent ||
    event instanceof WaitlistEntryPromotedEvent ||
    event instanceof WaitlistEntryExpiredEvent ||
    event instanceof WaitlistEntryCancelledEvent ||
    event instanceof WaitlistEntryNotifiedEvent
  ) {
    const p = event.payload;
    return {
      aggregateType: 'ReservationWaitlistEntry',
      aggregateId: p.entryId,
      staffRooms: [restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  // Table events: staff rooms only. `restaurantId` is not on any Table
  // event's own payload - resolved via `ctx` (see this file's own doc
  // comment on `RealtimeRoomResolutionContext`).
  if (
    event instanceof TableCreatedEvent ||
    event instanceof TableUpdatedEvent ||
    event instanceof TableDeletedEvent
  ) {
    const p = event.payload;
    const restaurantId = await ctx.resolveRestaurantIdForBranch(p.branchId);
    const staffRooms = restaurantId
      ? [restaurant(restaurantId), branch(p.branchId)]
      : [branch(p.branchId)];
    return {
      aggregateType: 'Table',
      aggregateId: p.tableId,
      staffRooms,
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  if (event instanceof TableStatusChangedEvent) {
    const p = event.payload;
    const restaurantId = await ctx.resolveRestaurantIdForBranch(p.branchId);
    const staffRooms = restaurantId
      ? [restaurant(restaurantId), branch(p.branchId)]
      : [branch(p.branchId)];
    return {
      aggregateType: 'Table',
      aggregateId: p.tableId,
      staffRooms,
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  if (event instanceof TableMovedEvent) {
    const p = event.payload;
    const restaurantId = await ctx.resolveRestaurantIdForBranch(p.branchId);
    const staffRooms = restaurantId
      ? [restaurant(restaurantId), branch(p.branchId)]
      : [branch(p.branchId)];
    return {
      aggregateType: 'Table',
      aggregateId: p.tableId,
      staffRooms,
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  // Phase 6 (Merge/Split Tables, ADR-026) - same staff-only Table-aggregate
  // pattern as TableMoved/TableStatusChanged above; `aggregateId` is the
  // group's Primary (the one `Table.id` future reservations ever target),
  // not `mergeGroupId` itself (that stays in the payload for clients that
  // need the full group).
  if (event instanceof TableMergedEvent || event instanceof TableSplitEvent) {
    const p = event.payload;
    const restaurantId = await ctx.resolveRestaurantIdForBranch(p.branchId);
    const staffRooms = restaurantId
      ? [restaurant(restaurantId), branch(p.branchId)]
      : [branch(p.branchId)];
    return {
      aggregateType: 'Table',
      aggregateId: p.primaryTableId,
      staffRooms,
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  // Restaurant events: organization + restaurant rooms, staff only.
  if (
    event instanceof RestaurantCreatedEvent ||
    event instanceof RestaurantUpdatedEvent ||
    event instanceof RestaurantDeletedEvent ||
    event instanceof RestaurantActivatedEvent ||
    event instanceof RestaurantSuspendedEvent
  ) {
    const p = event.payload;
    return {
      aggregateType: 'Restaurant',
      aggregateId: p.restaurantId,
      staffRooms: [org(p.organizationId), restaurant(p.restaurantId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  // Branch events: organization + restaurant + branch, staff only. §18's
  // BranchCreated special case: the branch room is omitted (the room did
  // not exist for anyone to have joined yet at creation time).
  if (event instanceof BranchCreatedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Branch',
      aggregateId: p.branchId,
      staffRooms: [org(p.organizationId), restaurant(p.restaurantId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  if (event instanceof BranchUpdatedEvent || event instanceof BranchDeletedEvent) {
    const p = event.payload;
    return {
      aggregateType: 'Branch',
      aggregateId: p.branchId,
      staffRooms: [org(p.organizationId), restaurant(p.restaurantId), branch(p.branchId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  // NotificationCreated (Phase 9, architecture frozen 2026-07-25, EVENTS.md's
  // Phase 9 broadcast note; extended Phase 19.9, ADR-037) - the one additive
  // Phase 9 realtime event. Broadcasts to `reservation:{id}` when the source
  // event that produced the Notification carried a `reservationId`;
  // otherwise (a Waitlist-sourced notification, or a Phase 19.9 Platform
  // Admin -> one Customer send) to the recipient's own `user:{userId}` room
  // instead, now that one exists - a strict widening of the original Phase 9
  // rule, not a behavior change for any reservation-sourced notification.
  // Payload minimized to `{ notificationId, type }` only - never `title`/
  // `body` (the frozen PII policy: a push/realtime payload must never carry
  // notification content, only enough to prompt an authenticated REST
  // fetch). No staff room.
  if (event instanceof NotificationCreatedEvent) {
    const p = event.payload;
    const customerRoom = p.reservationId !== null ? reservation(p.reservationId) : user(p.userId);
    return {
      aggregateType: 'Notification',
      aggregateId: p.notificationId,
      staffRooms: [],
      staffPayload: {},
      reservationRoom: customerRoom,
      customerPayload: { notificationId: p.notificationId, type: p.type },
    };
  }

  // Phase 15.6 (Messaging, DECISIONS.md D9) - one shared `conversation:{id}`
  // room for both sides; unlike Reservation events there is no separate
  // staff/customer payload split, since only actors who already passed
  // `RoomAuthorizationService.authorizeConversation` can be in the room at
  // all (the room's own join-time authorization IS the audience control).
  // Reuses the existing `staffRooms`/`staffPayload` fields as a generic
  // "broadcast this payload to these rooms" mechanism - no interface change
  // needed.
  if (
    event instanceof ConversationStartedEvent ||
    event instanceof MessageSentEvent ||
    event instanceof MessageReadEvent ||
    event instanceof ConversationClosedEvent
  ) {
    const p = event.payload;
    return {
      aggregateType: 'Conversation',
      aggregateId: p.conversationId,
      staffRooms: [conversation(p.conversationId)],
      staffPayload: { ...p },
      reservationRoom: null,
      customerPayload: null,
    };
  }

  // Explicitly excluded (Phase 8 §4): ReservationUpdated, ReservationPending,
  // authentication/security events, and every other unmapped/unknown event -
  // default-deny.
  return null;
}
