import { PromoteWaitlistEntryUseCase } from './promote-waitlist-entry.use-case';
import { WaitlistPromotionService } from '../services/waitlist-promotion.service';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistEntryNotFoundException } from '../../domain/exceptions/waitlist-entry-not-found.exception';
import { InvalidWaitlistStatusTransitionException } from '../../domain/exceptions/invalid-waitlist-status-transition.exception';
import { NoTableAvailableForPromotionException } from '../../domain/exceptions/no-table-available-for-promotion.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
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
import { InMemoryAcquisitionRecordingService } from '../../../../../test/reservations/support/in-memory-acquisition-recording.service';
import type { RecordCustomerAcquisitionOnApprovalService } from '@modules/customer-acquisition/application/services/record-customer-acquisition-on-approval.service';
import { ScheduleApprovedReservationSignalsService } from '@modules/reservations/application/services/schedule-approved-reservation-signals.service';

describe('PromoteWaitlistEntryUseCase', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const entryId = '11111111-1111-4111-8111-111111111111';

  function employeeActor(overrides?: { branchIds?: string[] }) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'employee-user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId,
      branchIds: overrides?.branchIds ?? [],
      permissions: ['reservations:waitlist'],
      permissionsVersion: 1,
    };
  }

  function entry(overrides: Partial<Parameters<typeof ReservationWaitlistEntry.create>[0]> = {}) {
    return ReservationWaitlistEntry.create({
      id: entryId,
      restaurantId,
      branchId,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reservationGuestId: null,
      partySize: 2,
      preferredDate: new Date('2026-08-01T00:00:00.000Z'),
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position: 1,
      expiresAt: new Date('2026-08-01T23:59:59.999Z'),
      notes: null,
      createdBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      now,
      ...overrides,
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

    const idGenerator = new SequentialIdGenerator(
      Array.from(
        { length: 10 },
        (_, i) => `aaaaaaaa-000a-4000-8000-${(i + 1).toString().padStart(12, '0')}`,
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
      new InMemoryAcquisitionRecordingService() as unknown as RecordCustomerAcquisitionOnApprovalService,
    );

    const useCase = new PromoteWaitlistEntryUseCase(
      waitlistRepository,
      branchRepository,
      restaurantSettingsRepository,
      new FixedClock(now),
      promotionService,
    );

    return { useCase, waitlistRepository, tableRepository };
  }

  it('promotes a Waiting entry when a table is available', async () => {
    const { useCase, waitlistRepository, tableRepository } = await build();
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
    await waitlistRepository.seed(entry());

    const result = await useCase.execute({ actor: employeeActor(), entryId });
    expect(result.status).toBe(WaitlistStatus.Converted);
  });

  it('throws 409 when no table is currently available', async () => {
    const { useCase, waitlistRepository } = await build();
    await waitlistRepository.seed(entry());

    await expect(useCase.execute({ actor: employeeActor(), entryId })).rejects.toThrow(
      NoTableAvailableForPromotionException,
    );
  });

  it('throws 400 when the entry is no longer eligible (already Converted)', async () => {
    const { useCase, waitlistRepository, tableRepository } = await build();
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
    // The entry is loaded from `findById` (still Waiting, per the fake's
    // seed) but `attemptPromotion`'s claim step races against a status
    // that's already moved on - simulate by seeding the row as Converted
    // directly, so `updateTransitioningFrom`'s expected-status check fails.
    await waitlistRepository.seed(entry().convert('other-reservation', now));

    await expect(useCase.execute({ actor: employeeActor(), entryId })).rejects.toThrow(
      InvalidWaitlistStatusTransitionException,
    );
  });

  it('throws 404 for an unknown entry id', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: employeeActor(), entryId: 'unknown-id' }),
    ).rejects.toThrow(WaitlistEntryNotFoundException);
  });

  it('rejects an Employee outside branch scope', async () => {
    const { useCase, waitlistRepository } = await build();
    await waitlistRepository.seed(entry());

    await expect(
      useCase.execute({ actor: employeeActor({ branchIds: ['other-branch'] }), entryId }),
    ).rejects.toThrow(EmployeeBranchNotAssignedException);
  });
});
