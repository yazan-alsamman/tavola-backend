import { SearchMyReservationsUseCase } from './search-my-reservations.use-case';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { MyReservationItem } from '../ports/my-reservations-reader.port';
import { InMemoryMyReservationsReader } from '../../../../../test/reservations/support/in-memory-my-reservations-reader';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('SearchMyReservationsUseCase', () => {
  const userId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '22222222-2222-4222-8222-222222222299';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const now = new Date('2026-08-15T00:00:00.000Z');

  function customerActor(id: string) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function employeeActor(id: string) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId,
      branchIds: [branchId],
      permissions: [],
      permissionsVersion: 1,
    };
  }

  function makeItem(overrides: Partial<MyReservationItem> = {}): MyReservationItem {
    return {
      reservationId: '11111111-1111-4111-8111-111111111111',
      restaurantId,
      restaurantName: 'The Old Mill',
      restaurantImage: null,
      branchId,
      branchName: '123 Main St',
      reservationDate: new Date('2026-08-10T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-10T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-10T19:30:00.000Z'),
      partySize: 2,
      status: ReservationStatus.Completed,
      reservationSource: ReservationSource.Online,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-10T20:00:00.000Z'),
      specialRequest: null,
      table: { tableId: '55555555-5555-4555-8555-555555555555', tableNumber: 'T1', capacity: 4 },
      ...overrides,
    };
  }

  function makeUseCase(reader: InMemoryMyReservationsReader) {
    return new SearchMyReservationsUseCase(reader, new FixedClock(now));
  }

  it("returns the caller's own reservations for scope 'all'", async () => {
    const reader = new InMemoryMyReservationsReader();
    reader.seed(userId, makeItem());
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 1,
      limit: 20,
      sort: 'reservationDate',
      order: 'desc',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].reservationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(reader.lastUserId).toBe(userId);
    expect(reader.lastScope).toBe('all');
  });

  it('returns an empty page when the caller has no reservations', async () => {
    const reader = new InMemoryMyReservationsReader();
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 1,
      limit: 20,
      sort: 'reservationDate',
      order: 'desc',
    });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('paginates results', async () => {
    const reader = new InMemoryMyReservationsReader();
    for (let i = 0; i < 3; i += 1) {
      reader.seed(
        userId,
        makeItem({
          reservationId: `11111111-1111-4111-8111-11111111111${i}`,
          reservationDate: new Date(`2026-08-0${i + 1}T00:00:00.000Z`),
        }),
      );
    }
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 2,
      limit: 2,
      sort: 'reservationDate',
      order: 'asc',
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(2);
  });

  it("filters by status (scope 'all' only)", async () => {
    const reader = new InMemoryMyReservationsReader();
    reader.seed(
      userId,
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111121',
        status: ReservationStatus.Completed,
      }),
    );
    reader.seed(
      userId,
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111122',
        status: ReservationStatus.Cancelled,
      }),
    );
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 1,
      limit: 20,
      status: ReservationStatus.Cancelled,
      sort: 'reservationDate',
      order: 'desc',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].status).toBe(ReservationStatus.Cancelled);
  });

  it('filters by restaurantId', async () => {
    const reader = new InMemoryMyReservationsReader();
    reader.seed(
      userId,
      makeItem({ reservationId: '11111111-1111-4111-8111-111111111131', restaurantId }),
    );
    reader.seed(
      userId,
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111132',
        restaurantId: '33333333-3333-4333-8333-333333333399',
      }),
    );
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 1,
      limit: 20,
      restaurantId,
      sort: 'reservationDate',
      order: 'desc',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].restaurantId).toBe(restaurantId);
  });

  it('filters by date range', async () => {
    const reader = new InMemoryMyReservationsReader();
    reader.seed(
      userId,
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111141',
        reservationDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    reader.seed(
      userId,
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111142',
        reservationDate: new Date('2026-06-01T00:00:00.000Z'),
      }),
    );
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 1,
      limit: 20,
      dateFrom: new Date('2026-03-01T00:00:00.000Z'),
      dateTo: new Date('2026-12-31T00:00:00.000Z'),
      sort: 'reservationDate',
      order: 'desc',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].reservationId).toBe('11111111-1111-4111-8111-111111111142');
  });

  it("never mixes in another customer's reservations (cross-customer isolation)", async () => {
    const reader = new InMemoryMyReservationsReader();
    reader.seed(userId, makeItem({ reservationId: '11111111-1111-4111-8111-111111111151' }));
    reader.seed(otherUserId, makeItem({ reservationId: '11111111-1111-4111-8111-111111111152' }));
    const useCase = makeUseCase(reader);

    const result = await useCase.execute({
      actor: customerActor(userId),
      scope: 'all',
      page: 1,
      limit: 20,
      sort: 'reservationDate',
      order: 'desc',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].reservationId).toBe('11111111-1111-4111-8111-111111111151');
  });

  it('rejects an Employee actor (Customer-only endpoint family)', async () => {
    const reader = new InMemoryMyReservationsReader();
    const useCase = makeUseCase(reader);

    await expect(
      useCase.execute({
        actor: employeeActor(userId),
        scope: 'all',
        page: 1,
        limit: 20,
        sort: 'reservationDate',
        order: 'desc',
      }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  describe('upcoming/history scope derivation', () => {
    const futureApproved = () =>
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111161',
        status: ReservationStatus.Approved,
        reservationStartTime: new Date('2026-09-01T18:00:00.000Z'),
      });
    const futurePending = () =>
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111162',
        status: ReservationStatus.Pending,
        reservationStartTime: new Date('2026-09-02T18:00:00.000Z'),
      });
    const pastCompleted = () =>
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111163',
        status: ReservationStatus.Completed,
        reservationStartTime: new Date('2026-07-01T18:00:00.000Z'),
      });
    const pastCancelled = () =>
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111164',
        status: ReservationStatus.Cancelled,
        reservationStartTime: new Date('2026-07-02T18:00:00.000Z'),
      });
    const rejectedButFutureScheduledTime = () =>
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111165',
        status: ReservationStatus.Rejected,
        reservationStartTime: new Date('2026-09-05T18:00:00.000Z'),
      });
    const stalePastApproved = () =>
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111166',
        status: ReservationStatus.Approved,
        reservationStartTime: new Date('2026-07-03T18:00:00.000Z'),
      });

    function seedAll(reader: InMemoryMyReservationsReader) {
      [
        futureApproved(),
        futurePending(),
        pastCompleted(),
        pastCancelled(),
        rejectedButFutureScheduledTime(),
        stalePastApproved(),
      ].forEach((item) => reader.seed(userId, item));
    }

    it("scope 'upcoming' returns only active reservations scheduled in the future", async () => {
      const reader = new InMemoryMyReservationsReader();
      seedAll(reader);
      const useCase = makeUseCase(reader);

      const result = await useCase.execute({
        actor: customerActor(userId),
        scope: 'upcoming',
        page: 1,
        limit: 20,
        sort: 'reservationDate',
        order: 'asc',
      });

      const ids = result.items.map((item) => item.reservationId).sort();
      expect(ids).toEqual(
        ['11111111-1111-4111-8111-111111111161', '11111111-1111-4111-8111-111111111162'].sort(),
      );
    });

    it("scope 'history' returns every terminal reservation plus any active-but-past one", async () => {
      const reader = new InMemoryMyReservationsReader();
      seedAll(reader);
      const useCase = makeUseCase(reader);

      const result = await useCase.execute({
        actor: customerActor(userId),
        scope: 'history',
        page: 1,
        limit: 20,
        sort: 'reservationDate',
        order: 'asc',
      });

      const ids = result.items.map((item) => item.reservationId).sort();
      expect(ids).toEqual(
        [
          '11111111-1111-4111-8111-111111111163',
          '11111111-1111-4111-8111-111111111164',
          '11111111-1111-4111-8111-111111111165',
          '11111111-1111-4111-8111-111111111166',
        ].sort(),
      );
    });

    it("'upcoming' and 'history' exactly partition scope 'all' (no gaps, no overlap)", async () => {
      const reader = new InMemoryMyReservationsReader();
      seedAll(reader);
      const useCase = makeUseCase(reader);

      const [all, upcoming, history] = await Promise.all([
        useCase.execute({
          actor: customerActor(userId),
          scope: 'all',
          page: 1,
          limit: 20,
          sort: 'reservationDate',
          order: 'asc',
        }),
        useCase.execute({
          actor: customerActor(userId),
          scope: 'upcoming',
          page: 1,
          limit: 20,
          sort: 'reservationDate',
          order: 'asc',
        }),
        useCase.execute({
          actor: customerActor(userId),
          scope: 'history',
          page: 1,
          limit: 20,
          sort: 'reservationDate',
          order: 'asc',
        }),
      ]);

      const allIds = all.items.map((item) => item.reservationId).sort();
      const combinedIds = [...upcoming.items, ...history.items]
        .map((item) => item.reservationId)
        .sort();
      expect(combinedIds).toEqual(allIds);
      expect(upcoming.total + history.total).toBe(all.total);
    });
  });
});
