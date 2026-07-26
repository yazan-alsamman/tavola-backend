import {
  ReservationApprovedEvent,
  ReservationCancelledEvent,
  ReservationCreatedEvent,
  ReservationRejectedEvent,
  ReservationReminderDueEvent,
  TableReadyNotifiedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import {
  WaitlistEntryCreatedEvent,
  WaitlistEntryNotifiedEvent,
} from '@modules/waitlist/domain/events/waitlist.events';
import {
  TableCreatedEvent,
  TableMergedEvent,
  TableMovedEvent,
  TableSplitEvent,
  TableStatusChangedEvent,
} from '@modules/tables/domain/events/table.events';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import { RestaurantCreatedEvent } from '@modules/restaurants/domain/events/restaurant.events';
import {
  BranchCreatedEvent,
  BranchUpdatedEvent,
} from '@modules/branches/domain/events/branch.events';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { NotificationCreatedEvent } from '@modules/notifications/domain/events/notification.events';
import { mapDomainEventForRealtime, RealtimeRoomResolutionContext } from './realtime-event-mapping';

const now = new Date('2026-07-24T10:00:00.000Z');
const reservationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const tableId = '44444444-4444-4444-8444-444444444444';
const organizationId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';
const employeeId = '77777777-7777-4777-8777-777777777777';

const notFoundCtx: RealtimeRoomResolutionContext = {
  resolveRestaurantIdForBranch: async () => null,
};

function resolvedCtx(restaurantIdToReturn: string): RealtimeRoomResolutionContext {
  return { resolveRestaurantIdForBranch: async () => restaurantIdToReturn };
}

class UnknownFutureEvent extends DomainEvent {
  public readonly eventName = 'SomeFutureEvent';
  constructor(eventId: string, occurredAt: Date) {
    super(eventId, occurredAt);
    this.seal();
  }
}

describe('mapDomainEventForRealtime', () => {
  it('returns null (default-deny) for an unmapped/unknown event', async () => {
    const result = await mapDomainEventForRealtime(
      new UnknownFutureEvent('event-1', now),
      notFoundCtx,
    );
    expect(result).toBeNull();
  });

  it('maps ReservationCreatedEvent to restaurant+branch staff rooms and a reservation room', async () => {
    const event = new ReservationCreatedEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        userId,
        reservationGuestId: null,
        source: ReservationSource.Online,
        createdBy: userId,
      },
      now,
      'corr-1',
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result).not.toBeNull();
    expect(result!.aggregateType).toBe('Reservation');
    expect(result!.aggregateId).toBe(reservationId);
    expect(result!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(result!.reservationRoom).toBe(`reservation:${reservationId}`);
  });

  it('strips actor identifiers from the customer-safe projection but keeps them in the staff projection', async () => {
    const event = new ReservationApprovedEvent(
      'event-1',
      { reservationId, restaurantId, branchId, tableId, approvedBy: employeeId, automatic: false },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffPayload).toMatchObject({ approvedBy: employeeId });
    expect(result!.customerPayload).not.toHaveProperty('approvedBy');
    expect(result!.customerPayload).toMatchObject({
      reservationId,
      restaurantId,
      branchId,
      tableId,
    });
  });

  it('strips rejectedBy from the customer-safe ReservationRejected projection', async () => {
    const event = new ReservationRejectedEvent(
      'event-1',
      { reservationId, restaurantId, branchId, tableId, rejectedBy: employeeId, automatic: false },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.customerPayload).not.toHaveProperty('rejectedBy');
  });

  it('strips cancelledBy from the customer-safe ReservationCancelled projection', async () => {
    const event = new ReservationCancelledEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        cancelledBy: userId,
        withinCancellationWindow: true,
      },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.customerPayload).not.toHaveProperty('cancelledBy');
    expect(result!.customerPayload).toMatchObject({ withinCancellationWindow: true });
  });

  it('routes TableReadyNotified into restaurant+branch+reservation rooms and strips markedBy for customers', async () => {
    const event = new TableReadyNotifiedEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        reservationStartTime: '2026-07-24T19:00:00.000Z',
        tableReadyNotifiedAt: '2026-07-24T19:05:00.000Z',
        markedBy: employeeId,
      },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.reservationRoom).toBe(`reservation:${reservationId}`);
    expect(result!.customerPayload).not.toHaveProperty('markedBy');
    expect(result!.staffPayload).toMatchObject({ markedBy: employeeId });
  });

  it('routes ReservationReminderDue to staff rooms only, no reservation room (operational staff signal)', async () => {
    const event = new ReservationReminderDueEvent(
      'event-1',
      { reservationId, restaurantId, branchId, reservationStartTime: '2026-07-24T19:00:00.000Z' },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(result!.reservationRoom).toBeNull();
    expect(result!.customerPayload).toBeNull();
  });

  it('routes Waitlist lifecycle events to staff rooms only, never a reservation/customer room', async () => {
    const event = new WaitlistEntryCreatedEvent(
      'event-1',
      {
        entryId: 'entry-1',
        restaurantId,
        branchId,
        userId,
        reservationGuestId: null,
        createdBy: userId,
      },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.aggregateType).toBe('ReservationWaitlistEntry');
    expect(result!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(result!.reservationRoom).toBeNull();
  });

  it('includes WaitlistEntryNotified (Phase 9, architecture frozen 2026-07-25, activated) in the staff-only Waitlist allow-list', async () => {
    const event = new WaitlistEntryNotifiedEvent(
      'event-1',
      { entryId: 'entry-1', restaurantId, branchId, notifiedAt: now.toISOString() },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.aggregateType).toBe('ReservationWaitlistEntry');
    expect(result!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(result!.reservationRoom).toBeNull();
  });

  it('NotificationCreated (Phase 9) broadcasts only to the reservation room, minimized to {notificationId, type}, when reservationId is set', async () => {
    const event = new NotificationCreatedEvent(
      'event-1',
      { notificationId: 'notif-1', userId, type: 'ReservationApproved', reservationId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([]);
    expect(result!.reservationRoom).toBe(`reservation:${reservationId}`);
    expect(result!.customerPayload).toEqual({
      notificationId: 'notif-1',
      type: 'ReservationApproved',
    });
  });

  it('NotificationCreated never leaks title/body/userId into the realtime payload', async () => {
    const event = new NotificationCreatedEvent(
      'event-1',
      { notificationId: 'notif-1', userId, type: 'ReservationApproved', reservationId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.customerPayload).not.toHaveProperty('userId');
    expect(result!.customerPayload).not.toHaveProperty('title');
    expect(result!.customerPayload).not.toHaveProperty('body');
  });

  it('NotificationCreated broadcasts nothing when reservationId is null (a Waitlist-sourced notification)', async () => {
    const event = new NotificationCreatedEvent(
      'event-1',
      { notificationId: 'notif-1', userId, type: 'WaitlistEntryPromoted', reservationId: null },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result).toBeNull();
  });

  it('resolves the restaurant room for Table events via the injected branch->restaurant resolver', async () => {
    const event = new TableCreatedEvent(
      'event-1',
      { tableId, branchId, floorPlanId: 'floor-1', organizationId, actorId: userId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, resolvedCtx(restaurantId));

    expect(result!.aggregateType).toBe('Table');
    expect(result!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
  });

  it('falls back to the branch room alone when the branch->restaurant resolver cannot find the branch', async () => {
    const event = new TableCreatedEvent(
      'event-1',
      { tableId, branchId, floorPlanId: 'floor-1', organizationId, actorId: userId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([`branch:${branchId}`]);
  });

  it('maps TableStatusChangedEvent and TableMovedEvent to Table-aggregate staff-only broadcasts', async () => {
    const statusChanged = new TableStatusChangedEvent(
      'event-1',
      {
        tableId,
        branchId,
        floorPlanId: 'floor-1',
        organizationId,
        fromStatus: TableStatus.Available,
        toStatus: TableStatus.Occupied,
        actorId: userId,
      },
      now,
    );
    const moved = new TableMovedEvent(
      'event-2',
      {
        tableId,
        branchId,
        organizationId,
        oldFloorPlanId: 'floor-1',
        newFloorPlanId: 'floor-2',
        actorId: userId,
      },
      now,
    );

    const statusResult = await mapDomainEventForRealtime(statusChanged, resolvedCtx(restaurantId));
    const movedResult = await mapDomainEventForRealtime(moved, resolvedCtx(restaurantId));

    expect(statusResult!.reservationRoom).toBeNull();
    expect(movedResult!.reservationRoom).toBeNull();
    expect(statusResult!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(movedResult!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
  });

  it('maps TableMergedEvent/TableSplitEvent to Table-aggregate staff-only broadcasts, keyed by the primary table id', async () => {
    const mergeGroupId = '88888888-8888-4888-8888-888888888888';
    const floorPlanId = 'floor-1';
    const merged = new TableMergedEvent(
      'event-1',
      {
        mergeGroupId,
        primaryTableId: tableId,
        memberTableIds: [tableId, 'other-table-id'],
        branchId,
        floorPlanId,
        organizationId,
        effectiveCapacity: 8,
        actorId: userId,
      },
      now,
    );
    const split = new TableSplitEvent(
      'event-2',
      {
        mergeGroupId,
        primaryTableId: tableId,
        memberTableIds: [tableId, 'other-table-id'],
        branchId,
        floorPlanId,
        organizationId,
        actorId: userId,
      },
      now,
    );

    const mergedResult = await mapDomainEventForRealtime(merged, resolvedCtx(restaurantId));
    const splitResult = await mapDomainEventForRealtime(split, resolvedCtx(restaurantId));

    expect(mergedResult!.aggregateType).toBe('Table');
    expect(mergedResult!.aggregateId).toBe(tableId);
    expect(mergedResult!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(mergedResult!.reservationRoom).toBeNull();
    expect(mergedResult!.customerPayload).toBeNull();

    expect(splitResult!.aggregateType).toBe('Table');
    expect(splitResult!.aggregateId).toBe(tableId);
    expect(splitResult!.staffRooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(splitResult!.reservationRoom).toBeNull();
    expect(splitResult!.customerPayload).toBeNull();
  });

  it('falls back to the branch room alone for TableMergedEvent when the branch->restaurant resolver cannot find the branch', async () => {
    const event = new TableMergedEvent(
      'event-1',
      {
        mergeGroupId: '88888888-8888-4888-8888-888888888888',
        primaryTableId: tableId,
        memberTableIds: [tableId, 'other-table-id'],
        branchId,
        floorPlanId: 'floor-1',
        organizationId,
        effectiveCapacity: 8,
        actorId: userId,
      },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([`branch:${branchId}`]);
  });

  it('maps Restaurant events to organization+restaurant rooms', async () => {
    const event = new RestaurantCreatedEvent(
      'event-1',
      { restaurantId, organizationId, actorId: userId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([
      `organization:${organizationId}`,
      `restaurant:${restaurantId}`,
    ]);
  });

  it('omits the branch room for BranchCreatedEvent (the room does not exist yet)', async () => {
    const event = new BranchCreatedEvent(
      'event-1',
      { branchId, restaurantId, organizationId, actorId: userId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([
      `organization:${organizationId}`,
      `restaurant:${restaurantId}`,
    ]);
    expect(result!.staffRooms).not.toContain(`branch:${branchId}`);
  });

  it('includes the branch room for BranchUpdatedEvent', async () => {
    const event = new BranchUpdatedEvent(
      'event-1',
      { branchId, restaurantId, organizationId, actorId: userId },
      now,
    );

    const result = await mapDomainEventForRealtime(event, notFoundCtx);

    expect(result!.staffRooms).toEqual([
      `organization:${organizationId}`,
      `restaurant:${restaurantId}`,
      `branch:${branchId}`,
    ]);
  });
});
