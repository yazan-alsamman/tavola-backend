import { RecheckWaitlistUseCase } from './recheck-waitlist.use-case';
import { WaitlistPromotionService } from '../services/waitlist-promotion.service';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationWaitlistEntryRepository } from '../../../../../test/waitlist/support/in-memory-reservation-waitlist-entry.repository';
import { InMemoryWaitlistExpirationScheduler } from '../../../../../test/waitlist/support/in-memory-waitlist-expiration-scheduler';
import { InMemoryApprovedReservationOperationalScheduler } from '../../../../../test/reservations/support/in-memory-approved-reservation-operational-scheduler';
import { ScheduleApprovedReservationSignalsService } from '@modules/reservations/application/services/schedule-approved-reservation-signals.service';

describe('RecheckWaitlistUseCase (FIFO-ordered first-serviceable)', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const preferredDate = new Date('2026-08-01T00:00:00.000Z');

  function makeEntry(id: string, position: number, partySize: number) {
    return ReservationWaitlistEntry.create({
      id,
      restaurantId,
      branchId,
      userId: `cccccccc-cccc-4ccc-8ccc-${position.toString().padStart(12, '0')}`,
      reservationGuestId: null,
      partySize,
      preferredDate,
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position,
      expiresAt: new Date('2026-08-01T23:59:59.999Z'),
      notes: null,
      createdBy: `cccccccc-cccc-4ccc-8ccc-${position.toString().padStart(12, '0')}`,
      now,
    });
  }

  async function build() {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const tableRepository = new InMemoryTableRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const waitlistRepository = new InMemoryReservationWaitlistEntryRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryWaitlistExpirationScheduler();

    await branchRepository.save(
      Branch.create({
        id: branchId,
        restaurantId,
        city: 'Damascus',
        district: null,
        address: '123 Main St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: null,
        timezone: 'UTC',
        phone: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    await restaurantSettingsRepository.save(
      RestaurantSettings.createDefault('settings-1', restaurantId, now),
    );
    await tableRepository.save(
      Table.create({
        id: tableId,
        branchId,
        floorPlanId: '88888888-8888-4888-8888-888888888888',
        tableNumber: 'T1',
        capacity: 4,
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
      }),
    );

    const idGenerator = new SequentialIdGenerator(
      Array.from(
        { length: 20 },
        (_, i) => `aaaaaaaa-0009-4000-8000-${(i + 1).toString().padStart(12, '0')}`,
      ),
    );

    const operationalScheduler = new InMemoryApprovedReservationOperationalScheduler();
    const scheduleApprovedReservationSignals = new ScheduleApprovedReservationSignalsService(
      operationalScheduler,
      restaurantSettingsRepository,
    );
    const promotionService = new WaitlistPromotionService(
      waitlistRepository,
      reservationRepository,
      tableRepository,
      idGenerator,
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
      scheduleApprovedReservationSignals,
    );

    const useCase = new RecheckWaitlistUseCase(
      waitlistRepository,
      branchRepository,
      restaurantSettingsRepository,
      new FixedClock(now),
      promotionService,
      new TenantContextService(),
    );

    return { useCase, waitlistRepository, tableRepository, reservationRepository };
  }

  it('skips an unserviceable head-of-queue entry and promotes the first serviceable one (FIFO-ordered first-serviceable)', async () => {
    const { useCase, waitlistRepository, reservationRepository } = await build();
    // Head entry (position 1) needs 8 seats - the only table only seats 4,
    // so it cannot be served. The second entry (position 2) needs 2 seats
    // and should be promoted instead.
    const head = makeEntry('e1', 1, 8);
    const second = makeEntry('e2', 2, 2);
    await waitlistRepository.seed(head);
    await waitlistRepository.seed(second);

    await useCase.execute({ branchId, preferredDateIso: '2026-08-01', organizationId: null });

    const headAfter = await waitlistRepository.findById('e1');
    const secondAfter = await waitlistRepository.findById('e2');
    expect(headAfter?.status).toBe(WaitlistStatus.Waiting);
    expect(headAfter?.position).toBe(1);
    expect(secondAfter?.status).toBe(WaitlistStatus.Converted);
    expect(secondAfter?.convertedReservationId).not.toBeNull();

    const convertedReservationId = secondAfter?.convertedReservationId as string;
    const reservation = await reservationRepository.findById(
      ReservationId.create(convertedReservationId),
    );
    expect(reservation).not.toBeNull();
  });

  it('does not mutate the skipped head entry at all (no cancel/expire/reorder)', async () => {
    const { useCase, waitlistRepository } = await build();
    const head = makeEntry('e1', 1, 8);
    const second = makeEntry('e2', 2, 2);
    await waitlistRepository.seed(head);
    await waitlistRepository.seed(second);

    await useCase.execute({ branchId, preferredDateIso: '2026-08-01', organizationId: null });

    const headAfter = await waitlistRepository.findById('e1');
    expect(headAfter?.toProps()).toEqual(head.toProps());
  });

  it('promotes at most one entry per re-check, even when multiple are serviceable', async () => {
    const { useCase, waitlistRepository } = await build();
    const first = makeEntry('e1', 1, 2);
    const second = makeEntry('e2', 2, 2);
    await waitlistRepository.seed(first);
    await waitlistRepository.seed(second);

    await useCase.execute({ branchId, preferredDateIso: '2026-08-01', organizationId: null });

    const firstAfter = await waitlistRepository.findById('e1');
    const secondAfter = await waitlistRepository.findById('e2');
    expect(firstAfter?.status).toBe(WaitlistStatus.Converted);
    expect(secondAfter?.status).toBe(WaitlistStatus.Waiting);
  });

  it('is a safe no-op when nothing is serviceable', async () => {
    const { useCase, waitlistRepository } = await build();
    const tooLarge = makeEntry('e1', 1, 99);
    await waitlistRepository.seed(tooLarge);

    await useCase.execute({ branchId, preferredDateIso: '2026-08-01', organizationId: null });

    const after = await waitlistRepository.findById('e1');
    expect(after?.status).toBe(WaitlistStatus.Waiting);
  });

  it('is a safe no-op when the branch no longer exists', async () => {
    const { useCase, waitlistRepository } = await build();
    const entry = makeEntry('e1', 1, 2);
    await waitlistRepository.seed(entry);

    await expect(
      useCase.execute({
        branchId: '99999999-9999-4999-8999-999999999999',
        preferredDateIso: '2026-08-01',
        organizationId: null,
      }),
    ).resolves.toBeUndefined();

    const after = await waitlistRepository.findById('e1');
    expect(after?.status).toBe(WaitlistStatus.Waiting);
  });
});
