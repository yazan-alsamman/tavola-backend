import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { BranchRepository } from '@modules/branches/domain/repositories/branch.repository';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import {
  ReservationApprovedEvent,
  ReservationCreatedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { TableCreatedEvent } from '@modules/tables/domain/events/table.events';
import { AccountLockedEvent } from '@modules/authentication/domain/events/authentication.events';
import { RealtimeBroadcasterPort } from '../../domain/ports/realtime-broadcaster.port';
import { RealtimeEnvelope } from '../../application/realtime-envelope';
import { RealtimeEventPublisher } from './realtime-event-publisher';

const now = new Date('2026-07-24T10:00:00.000Z');
const reservationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const tableId = '44444444-4444-4444-8444-444444444444';
const organizationId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';

class RecordingInnerPublisher implements EventPublisherPort {
  readonly published: DomainEvent[] = [];
  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
  }
  async publishAll(events: DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }
}

class ThrowingInnerPublisher implements EventPublisherPort {
  async publish(): Promise<void> {
    throw new Error('inner publisher failed');
  }
  async publishAll(): Promise<void> {
    throw new Error('inner publisher failed');
  }
}

class RecordingBroadcaster implements RealtimeBroadcasterPort {
  readonly calls: Array<{ rooms: readonly string[]; envelope: RealtimeEnvelope }> = [];
  async broadcast(rooms: readonly string[], envelope: RealtimeEnvelope): Promise<void> {
    this.calls.push({ rooms, envelope });
  }
}

class ThrowingBroadcaster implements RealtimeBroadcasterPort {
  async broadcast(): Promise<void> {
    throw new Error('broadcaster failed');
  }
}

class StubBranchRepository implements Pick<BranchRepository, 'findById'> {
  constructor(private readonly branch: Branch | null) {}
  async findById(): Promise<Branch | null> {
    return this.branch;
  }
}

function buildPublisher(options: {
  inner?: EventPublisherPort;
  broadcaster?: RealtimeBroadcasterPort;
  branch?: Branch | null;
}) {
  const inner = options.inner ?? new RecordingInnerPublisher();
  const broadcaster = options.broadcaster ?? new RecordingBroadcaster();
  const branchRepository = new StubBranchRepository(
    options.branch === undefined ? null : options.branch,
  ) as unknown as BranchRepository;
  const publisher = new RealtimeEventPublisher(inner, broadcaster, branchRepository);
  return { publisher, inner, broadcaster };
}

describe('RealtimeEventPublisher', () => {
  it('always publishes to the inner publisher first, unconditionally', async () => {
    const { publisher, inner } = buildPublisher({});
    const event = new ReservationApprovedEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        approvedBy: 'employee-1',
        automatic: false,
      },
      now,
    );

    await publisher.publish(event);

    expect((inner as RecordingInnerPublisher).published).toEqual([event]);
  });

  it('broadcasts to staff rooms and the reservation room for an allow-listed reservation event', async () => {
    const { publisher, broadcaster } = buildPublisher({});
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

    await publisher.publish(event);

    const calls = (broadcaster as RecordingBroadcaster).calls;
    expect(calls).toHaveLength(2);
    expect(calls[0].rooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
    expect(calls[0].envelope).toMatchObject({
      eventId: 'event-1',
      eventType: 'ReservationCreated',
      aggregateType: 'Reservation',
      aggregateId: reservationId,
      correlationId: 'corr-1',
    });
    expect(calls[0].envelope.occurredAt).toBe(now.toISOString());
    expect(calls[1].rooms).toEqual([`reservation:${reservationId}`]);
    expect(calls[1].envelope.data).not.toHaveProperty('userId');
  });

  it('does not broadcast at all for a non-allow-listed event', async () => {
    const { publisher, broadcaster } = buildPublisher({});
    const event = new AccountLockedEvent(
      'event-1',
      { userId, lockedUntil: now, failedAttempts: 5 },
      now,
    );

    await publisher.publish(event);

    expect((broadcaster as RecordingBroadcaster).calls).toHaveLength(0);
  });

  it('resolves the restaurant room for a Table event via BranchRepository', async () => {
    const branch = Branch.create({
      id: branchId,
      restaurantId,
      city: 'Damascus',
      district: null,
      address: '123 Main St',
      latitude: null,
      longitude: null,
      countryCode: 'SY',
      currency: null,
      timezone: 'Asia/Damascus',
      phone: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const { publisher, broadcaster } = buildPublisher({ branch });
    const event = new TableCreatedEvent(
      'event-1',
      { tableId, branchId, floorPlanId: 'floor-1', organizationId, actorId: userId },
      now,
    );

    await publisher.publish(event);

    const calls = (broadcaster as RecordingBroadcaster).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].rooms).toEqual([`restaurant:${restaurantId}`, `branch:${branchId}`]);
  });

  it('never rethrows a broadcaster failure - the inner publish already succeeded', async () => {
    const { publisher, inner } = buildPublisher({ broadcaster: new ThrowingBroadcaster() });
    const event = new ReservationApprovedEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        approvedBy: 'employee-1',
        automatic: false,
      },
      now,
    );

    await expect(publisher.publish(event)).resolves.toBeUndefined();
    expect((inner as RecordingInnerPublisher).published).toEqual([event]);
  });

  it('propagates an inner publisher failure without attempting to broadcast', async () => {
    const { publisher, broadcaster } = buildPublisher({ inner: new ThrowingInnerPublisher() });
    const event = new ReservationApprovedEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        approvedBy: 'employee-1',
        automatic: false,
      },
      now,
    );

    await expect(publisher.publish(event)).rejects.toThrow('inner publisher failed');
    expect((broadcaster as RecordingBroadcaster).calls).toHaveLength(0);
  });

  it('publishAll publishes every event to inner first, then attempts to broadcast each', async () => {
    const { publisher, inner, broadcaster } = buildPublisher({});
    const eventA = new ReservationApprovedEvent(
      'event-1',
      {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        approvedBy: 'employee-1',
        automatic: false,
      },
      now,
    );
    const eventB = new AccountLockedEvent(
      'event-2',
      { userId, lockedUntil: now, failedAttempts: 5 },
      now,
    );

    await publisher.publishAll([eventA, eventB]);

    expect((inner as RecordingInnerPublisher).published).toEqual([eventA, eventB]);
    expect((broadcaster as RecordingBroadcaster).calls.length).toBeGreaterThan(0);
  });
});
