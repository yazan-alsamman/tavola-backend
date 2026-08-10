import { WaitlistPromotionService } from './waitlist-promotion.service';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistEntryPromotedEvent } from '../../domain/events/waitlist.events';
import { ReservationCreatedEvent } from '@modules/reservations/domain/events/reservation.events';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { ReservationId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationWaitlistEntryRepository } from '../../../../../test/waitlist/support/in-memory-reservation-waitlist-entry.repository';
import { InMemoryWaitlistExpirationScheduler } from '../../../../../test/waitlist/support/in-memory-waitlist-expiration-scheduler';
import { InMemoryApprovedReservationOperationalScheduler } from '../../../../../test/reservations/support/in-memory-approved-reservation-operational-scheduler';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryAcquisitionRecordingService } from '../../../../../test/reservations/support/in-memory-acquisition-recording.service';
import type { RecordCustomerAcquisitionOnApprovalService } from '@modules/customer-acquisition/application/services/record-customer-acquisition-on-approval.service';
import { ScheduleApprovedReservationSignalsService } from '@modules/reservations/application/services/schedule-approved-reservation-signals.service';

describe('WaitlistPromotionService', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const branchId = '44444444-4444-4444-8444-444444444444';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const userId = '22222222-2222-4222-8222-222222222222';
  const smallTableId = '55555555-5555-4555-8555-555555555551';
  const largeTableId = '55555555-5555-4555-8555-555555555552';

  function entry(overrides: Partial<Parameters<typeof ReservationWaitlistEntry.create>[0]> = {}) {
    return ReservationWaitlistEntry.create({
      id: '11111111-1111-4111-8111-111111111111',
      restaurantId,
      branchId,
      userId,
      reservationGuestId: null,
      partySize: 2,
      preferredDate: new Date('2026-08-01T00:00:00.000Z'),
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position: 1,
      expiresAt: new Date('2026-08-01T23:59:59.999Z'),
      notes: null,
      createdBy: userId,
      now,
      ...overrides,
    });
  }

  function table(id: string, capacity: number, tableNumber: string) {
    return Table.create({
      id,
      branchId,
      floorPlanId: '88888888-8888-4888-8888-888888888888',
      tableNumber,
      capacity,
      floor: null,
      positionX: null,
      positionY: null,
      width: null,
      height: null,
      rotation: null,
      shape: TableShape.Rectangle,
      layer: null,
      indoor: true,
      vip: false,
      smoking: false,
      status: TableStatus.Available,
      mergeGroupId: null,
      isMergePrimary: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  async function build() {
    const waitlistRepository = new InMemoryReservationWaitlistEntryRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const tableRepository = new InMemoryTableRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryWaitlistExpirationScheduler();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const operationalScheduler = new InMemoryApprovedReservationOperationalScheduler();
    const scheduleApprovedReservationSignals = new ScheduleApprovedReservationSignalsService(
      operationalScheduler,
      restaurantSettingsRepository,
    );

    const service = new WaitlistPromotionService(
      waitlistRepository,
      reservationRepository,
      tableRepository,
      new SequentialIdGenerator([
        'aaaaaaaa-0005-4000-8000-000000000001',
        'aaaaaaaa-0005-4000-8000-000000000002',
        'aaaaaaaa-0005-4000-8000-000000000003',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
      scheduleApprovedReservationSignals,
      new InMemoryAcquisitionRecordingService() as unknown as RecordCustomerAcquisitionOnApprovalService,
    );

    return {
      service,
      waitlistRepository,
      reservationRepository,
      tableRepository,
      eventPublisher,
      expirationScheduler,
      operationalScheduler,
    };
  }

  it('promotes into the smallest sufficient-capacity table, auto-approved', async () => {
    const { service, tableRepository, eventPublisher, expirationScheduler, waitlistRepository } =
      await build();
    await tableRepository.save(table(largeTableId, 8, 'T-LARGE'));
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    const candidate = entry();
    await waitlistRepository.seed(candidate);

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: null,
      now,
    });

    expect(outcome.promoted).toBe(true);
    if (!outcome.promoted) throw new Error('expected promotion');

    const reservedTable = await tableRepository.findById(TableId.create(smallTableId));
    expect(reservedTable?.status).toBe(TableStatus.Reserved);
    const untouchedLargeTable = await tableRepository.findById(TableId.create(largeTableId));
    expect(untouchedLargeTable?.status).toBe(TableStatus.Available);

    const converted = await waitlistRepository.findById(candidate.entryId);
    expect(converted?.status).toBe(WaitlistStatus.Converted);
    expect(converted?.convertedReservationId).toBe(outcome.reservationId);

    expect(expirationScheduler.cancelledEntryIds).toContain(candidate.entryId);

    const promotedEvent = eventPublisher.events.find(
      (e) => e instanceof WaitlistEntryPromotedEvent,
    );
    expect(promotedEvent).toBeDefined();
    const createdEvent = eventPublisher.events.find((e) => e instanceof ReservationCreatedEvent) as
      ReservationCreatedEvent | undefined;
    expect(createdEvent?.payload.source).toBe(ReservationSource.WaitlistConversion);
    expect(createdEvent?.payload.createdBy).toBeNull();
    expect(createdEvent?.payload.userId).toBe(userId);
  });

  it('acquires the ADR-026 topology lock BEFORE ADR-013 slot lock/insert', async () => {
    const { service, tableRepository, reservationRepository, waitlistRepository } = await build();
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    const candidate = entry();
    await waitlistRepository.seed(candidate);
    const topologyLockSpy = jest.spyOn(tableRepository, 'acquireTopologyLocks');
    const createWithLockSpy = jest.spyOn(reservationRepository, 'createWithLockInTransaction');

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: null,
      now,
    });

    expect(outcome.promoted).toBe(true);
    expect(topologyLockSpy).toHaveBeenCalledWith([smallTableId]);
    expect(topologyLockSpy.mock.invocationCallOrder[0]).toBeLessThan(
      createWithLockSpy.mock.invocationCallOrder[0],
    );
  });

  it('uses the merge group effectiveCapacity for a merge Primary table, not its own capacity column', async () => {
    const { service, tableRepository, reservationRepository, waitlistRepository } = await build();
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    const mergeGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondaryTableId = '55555555-5555-4555-8555-555555555553';
    await tableRepository.save(table(secondaryTableId, 4, 'T-SECONDARY'));
    const primary = await tableRepository.findById(TableId.create(smallTableId));
    const secondary = await tableRepository.findById(TableId.create(secondaryTableId));
    await tableRepository.save(primary!.asMergePrimary(mergeGroupId, now));
    await tableRepository.save(secondary!.asMergeSecondary(mergeGroupId, now));
    // 6 exceeds the Primary's own capacity (4) but fits the merge group's
    // effectiveCapacity (4 + 4 = 8).
    const candidate = entry({ partySize: 6 });
    await waitlistRepository.seed(candidate);

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: null,
      now,
    });

    expect(outcome.promoted).toBe(true);
    if (!outcome.promoted) throw new Error('expected promotion');
    const reservation = await reservationRepository.findById(
      ReservationId.create(outcome.reservationId),
    );
    expect(reservation?.tableId.value).toBe(smallTableId);
    expect(reservation?.guests).toBe(6);
  });

  it('creates a Pending Reservation and does not reserve a table when autoApproval is false', async () => {
    const { service, tableRepository, waitlistRepository, reservationRepository } = await build();
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    const candidate = entry();
    await waitlistRepository.seed(candidate);

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: false,
      promotedBy: 'employee-1',
      now,
    });

    expect(outcome.promoted).toBe(true);
    if (!outcome.promoted) throw new Error('expected promotion');
    const table1 = await tableRepository.findById(TableId.create(smallTableId));
    expect(table1?.status).toBe(TableStatus.Available);
    const reservation = await reservationRepository.findById(
      ReservationId.create(outcome.reservationId),
    );
    expect(reservation?.status).toBe(ReservationStatus.Pending);
    expect(reservation?.createdBy).toBe('employee-1');
  });

  it('is not-serviceable when the derived start time has already passed', async () => {
    const { service, tableRepository, waitlistRepository } = await build();
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    // preferredTimeFrom before `now`'s time-of-day on the same date.
    const candidate = entry({ preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)) });
    await waitlistRepository.seed(candidate);

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: null,
      now,
    });

    expect(outcome).toEqual({ promoted: false, reason: 'not-serviceable' });
    const untouched = await waitlistRepository.findById(candidate.entryId);
    expect(untouched?.status).toBe(WaitlistStatus.Waiting);
  });

  it('is not-serviceable when no table has sufficient capacity', async () => {
    const { service, tableRepository, waitlistRepository } = await build();
    await tableRepository.save(table(smallTableId, 2, 'T-SMALL'));
    const candidate = entry({ partySize: 6 });
    await waitlistRepository.seed(candidate);

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: null,
      now,
    });

    expect(outcome).toEqual({ promoted: false, reason: 'not-serviceable' });
  });

  it('reports lost-claim-race and leaves the entry untouched when a concurrent claim already converted it', async () => {
    const { service, tableRepository, waitlistRepository } = await build();
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    const candidate = entry();
    // Simulate a concurrent winner: seed the repository with the entry
    // already Converted, but pass the STALE in-memory `candidate` (still
    // Waiting) as the attempt's input - mirrors a real race where two
    // requests both read the row as Waiting before either commits.
    const alreadyConverted = candidate.convert('some-other-reservation', now);
    await waitlistRepository.seed(alreadyConverted);

    const outcome = await service.attemptPromotion({
      entry: candidate,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: null,
      now,
    });

    expect(outcome).toEqual({ promoted: false, reason: 'lost-claim-race' });
    const stillConverted = await waitlistRepository.findById(candidate.entryId);
    expect(stillConverted?.convertedReservationId).toBe('some-other-reservation');
  });

  it('never uses the guest-backed party fields when the entry is user-backed, and vice versa', async () => {
    const { service, tableRepository, reservationRepository, waitlistRepository } = await build();
    await tableRepository.save(table(smallTableId, 4, 'T-SMALL'));
    const guestEntry = entry({ userId: null, reservationGuestId: 'guest-abc' });
    await waitlistRepository.seed(guestEntry);

    const outcome = await service.attemptPromotion({
      entry: guestEntry,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy: 'employee-1',
      now,
    });

    expect(outcome.promoted).toBe(true);
    if (!outcome.promoted) throw new Error('expected promotion');
    const reservation = await reservationRepository.findById(
      ReservationId.create(outcome.reservationId),
    );
    expect(reservation?.userId).toBeNull();
    expect(reservation?.reservationGuestId).toBe('guest-abc');
  });
});
