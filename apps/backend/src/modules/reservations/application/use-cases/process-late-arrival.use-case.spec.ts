import { ProcessLateArrivalUseCase } from './process-late-arrival.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { GuestLateArrivalNotifiedEvent } from '../../domain/events/reservation.events';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { LateArrivalJobData } from '../../infrastructure/bullmq/late-arrival-queue.constants';

describe('ProcessLateArrivalUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';
  const startTime = new Date('2026-08-01T18:00:00.000Z');
  const processingTime = new Date('2026-08-01T18:15:00.000Z');

  function approvedReservation(overrides?: {
    status?: ReservationStatus;
    lateArrivalNotifiedAt?: Date | null;
  }) {
    const created = Reservation.create({
      id: reservationId,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      now: fixedNow,
    });
    return Reservation.reconstitute({
      ...created.toProps(),
      status: overrides?.status ?? ReservationStatus.Approved,
      lateArrivalNotifiedAt: overrides?.lateArrivalNotifiedAt ?? null,
    });
  }

  function jobData(overrides?: Partial<LateArrivalJobData>): LateArrivalJobData {
    return {
      reservationId,
      restaurantId,
      branchId,
      organizationId: null,
      reservationStartTime: startTime.toISOString(),
      ...overrides,
    };
  }

  function build() {
    const reservationRepository = new InMemoryReservationRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ProcessLateArrivalUseCase(
      reservationRepository,
      new FixedClock(processingTime),
      new SequentialIdGenerator(['aaaaaaaa-0009-4000-8000-000000000001']),
      eventPublisher,
      new TenantContextService(),
    );
    return { useCase, reservationRepository, eventPublisher };
  }

  it('marks lateArrivalNotifiedAt and publishes GuestLateArrivalNotified for a still-Approved, not-yet-notified reservation', async () => {
    const { useCase, reservationRepository, eventPublisher } = build();
    reservationRepository.seed(approvedReservation());

    await useCase.execute(jobData());

    const updated = await reservationRepository.findById(ReservationId.create(reservationId));
    expect(updated?.lateArrivalNotifiedAt).toEqual(processingTime);

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as GuestLateArrivalNotifiedEvent;
    expect(event).toBeInstanceOf(GuestLateArrivalNotifiedEvent);
    expect(event.payload).toMatchObject({ reservationId, restaurantId, branchId });
  });

  it('is a safe no-op when the reservation no longer exists', async () => {
    const { useCase, eventPublisher } = build();

    await expect(useCase.execute(jobData())).resolves.toBeUndefined();

    expect(eventPublisher.events).toHaveLength(0);
  });

  it.each([
    ReservationStatus.Pending,
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.Expired,
    ReservationStatus.NoShow,
  ])('is a safe no-op when the reservation is no longer Approved (%s)', async (status) => {
    const { useCase, reservationRepository, eventPublisher } = build();
    reservationRepository.seed(approvedReservation({ status }));

    await useCase.execute(jobData());

    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op when already notified by a prior run (CAS false)', async () => {
    const { useCase, reservationRepository, eventPublisher } = build();
    reservationRepository.seed(
      approvedReservation({ lateArrivalNotifiedAt: new Date('2026-08-01T18:10:00.000Z') }),
    );

    await useCase.execute(jobData());

    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op when reservationStartTime no longer matches the job (stale after Reschedule)', async () => {
    const { useCase, reservationRepository, eventPublisher } = build();
    reservationRepository.seed(approvedReservation());

    await useCase.execute(
      jobData({ reservationStartTime: new Date('2026-08-01T20:00:00.000Z').toISOString() }),
    );

    expect(eventPublisher.events).toHaveLength(0);
    const unchanged = await reservationRepository.findById(ReservationId.create(reservationId));
    expect(unchanged?.lateArrivalNotifiedAt).toBeNull();
  });

  it('establishes tenant context from the job payload before executing', async () => {
    const eventPublisher = new CollectingEventPublisher();
    const tenantContext = new TenantContextService();
    let observedOrganizationId: string | null | undefined;

    class ObservingReservationRepository extends InMemoryReservationRepository {
      async markLateArrivalNotifiedIfEligible(
        id: Parameters<InMemoryReservationRepository['markLateArrivalNotifiedIfEligible']>[0],
        at: Date,
      ) {
        observedOrganizationId = tenantContext.getOrganizationId();
        return super.markLateArrivalNotifiedIfEligible(id, at);
      }
    }
    const observingRepository = new ObservingReservationRepository();
    observingRepository.seed(approvedReservation());

    const useCase = new ProcessLateArrivalUseCase(
      observingRepository,
      new FixedClock(processingTime),
      new SequentialIdGenerator(['aaaaaaaa-0009-4000-8000-000000000002']),
      eventPublisher,
      tenantContext,
    );

    await useCase.execute(jobData({ organizationId: null }));

    expect(observedOrganizationId).toBeNull();
  });
});
