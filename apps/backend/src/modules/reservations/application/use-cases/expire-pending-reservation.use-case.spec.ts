import { ExpirePendingReservationUseCase } from './expire-pending-reservation.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationExpiredEvent } from '../../domain/events/reservation.events';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationHistoryRepository } from '../../../../../test/reservations/support/in-memory-reservation-history.repository';

describe('ExpirePendingReservationUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';
  const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const organizationId = 'org-1';

  function pendingReservation(overrides?: { status?: ReservationStatus }) {
    const created = Reservation.create({
      id: reservationId,
      userId: customerId,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: customerId,
      now: fixedNow,
    });
    return overrides?.status
      ? Reservation.reconstitute({ ...created.toProps(), status: overrides.status })
      : created;
  }

  async function build() {
    const reservationRepository = new InMemoryReservationRepository();
    const reservationHistoryRepository = new InMemoryReservationHistoryRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ExpirePendingReservationUseCase(
      reservationRepository,
      reservationHistoryRepository,
      new FixedClock(new Date('2026-08-01T18:30:00.000Z')),
      new SequentialIdGenerator([
        'aaaaaaaa-0005-4000-8000-000000000001',
        'aaaaaaaa-0005-4000-8000-000000000002',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      new TenantContextService(),
    );

    return { useCase, reservationRepository, reservationHistoryRepository, eventPublisher };
  }

  it('expires a Pending reservation, recording ReservationHistory with no actor', async () => {
    const { useCase, reservationRepository, reservationHistoryRepository } = await build();
    await reservationRepository.seed(pendingReservation());

    await useCase.execute({ reservationId, organizationId });

    expect(reservationHistoryRepository.rows).toHaveLength(1);
    expect(reservationHistoryRepository.rows[0]).toMatchObject({
      oldStatus: ReservationStatus.Pending,
      newStatus: ReservationStatus.Expired,
      changedBy: null,
    });
  });

  it('publishes ReservationExpired for a Pending reservation that expires', async () => {
    const { useCase, reservationRepository, eventPublisher } = await build();
    await reservationRepository.seed(pendingReservation());

    await useCase.execute({ reservationId, organizationId });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as ReservationExpiredEvent;
    expect(event).toBeInstanceOf(ReservationExpiredEvent);
    expect(event.payload).toMatchObject({ reservationId });
  });

  it.each([
    ReservationStatus.Approved,
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.NoShow,
    ReservationStatus.Expired,
  ])('is a safe no-op when the reservation is already %s', async (status) => {
    const { useCase, reservationRepository, reservationHistoryRepository, eventPublisher } =
      await build();
    await reservationRepository.seed(pendingReservation({ status }));

    await expect(useCase.execute({ reservationId, organizationId })).resolves.toBeUndefined();

    expect(reservationHistoryRepository.rows).toHaveLength(0);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op for an unknown reservation id', async () => {
    const { useCase, reservationHistoryRepository, eventPublisher } = await build();

    await expect(
      useCase.execute({ reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', organizationId }),
    ).resolves.toBeUndefined();

    expect(reservationHistoryRepository.rows).toHaveLength(0);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('establishes tenant context from the job payload before executing', async () => {
    const reservationHistoryRepository = new InMemoryReservationHistoryRepository();
    const eventPublisher = new CollectingEventPublisher();
    const tenantContext = new TenantContextService();
    let observedOrganizationId: string | null | undefined;

    class ObservingReservationRepository extends InMemoryReservationRepository {
      async findById(id: Parameters<InMemoryReservationRepository['findById']>[0]) {
        observedOrganizationId = tenantContext.getOrganizationId();
        return super.findById(id);
      }
    }
    const observingRepository = new ObservingReservationRepository();
    await observingRepository.seed(pendingReservation());

    const useCase = new ExpirePendingReservationUseCase(
      observingRepository,
      reservationHistoryRepository,
      new FixedClock(new Date('2026-08-01T18:30:00.000Z')),
      new SequentialIdGenerator([
        'aaaaaaaa-0005-4000-8000-000000000003',
        'aaaaaaaa-0005-4000-8000-000000000004',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      tenantContext,
    );

    await useCase.execute({ reservationId, organizationId });

    expect(observedOrganizationId).toBe(organizationId);
  });
});
