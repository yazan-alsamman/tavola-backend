import { ListBranchReservationsUseCase } from './list-branch-reservations.use-case';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { InvalidReservationDateRangeException } from '../../domain/exceptions/invalid-reservation-date-range.exception';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { StaffReservationItem } from '../ports/staff-reservations-reader.port';
import { InMemoryStaffReservationsReader } from '../../../../../test/reservations/support/in-memory-staff-reservations-reader';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';

describe('ListBranchReservationsUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const otherRestaurantId = '33333333-3333-4333-8333-333333333399';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const otherBranchId = '44444444-4444-4444-8444-444444444499';

  function employeeActor(overrides: Partial<{ restaurantId: string; branchIds: string[] }> = {}) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'employee-user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: overrides.restaurantId ?? restaurantId,
      branchIds: overrides.branchIds ?? [],
      permissions: [],
      permissionsVersion: 1,
    };
  }

  function customerActor() {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function orgMemberActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: 'org-1',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  function makeItem(overrides: Partial<StaffReservationItem> = {}): StaffReservationItem {
    return {
      reservationId: '11111111-1111-4111-8111-111111111111',
      restaurantId,
      branchId,
      reservationDate: new Date('2026-08-10T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-10T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-10T19:30:00.000Z'),
      partySize: 2,
      status: ReservationStatus.Approved,
      reservationSource: ReservationSource.Online,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-10T20:00:00.000Z'),
      specialRequest: null,
      table: { tableId: '55555555-5555-4555-8555-555555555555', tableNumber: 'T1', capacity: 4 },
      customer: { type: 'User', name: 'Jane Doe', phone: '+963991234567' },
      ...overrides,
    };
  }

  async function seedBranch(branchRepository: InMemoryBranchRepository): Promise<void> {
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
        timezone: 'Asia/Damascus',
        phone: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      }),
    );
  }

  function makeUseCase(
    reader: InMemoryStaffReservationsReader,
    branchRepository: InMemoryBranchRepository,
  ) {
    return new ListBranchReservationsUseCase(reader, branchRepository);
  }

  it("returns a branch-scoped Employee's own branch reservations within the date range", async () => {
    const reader = new InMemoryStaffReservationsReader();
    reader.seed(makeItem());
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      restaurantId,
      branchId,
      dateFrom: new Date('2026-08-01T00:00:00.000Z'),
      dateTo: new Date('2026-08-31T00:00:00.000Z'),
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0].reservationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(reader.lastRestaurantId).toBe(restaurantId);
    expect(reader.lastBranchId).toBe(branchId);
  });

  it('allows a restaurant-wide Employee (empty branchIds) to view any branch of their own restaurant', async () => {
    const reader = new InMemoryStaffReservationsReader();
    reader.seed(makeItem());
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [] }),
      restaurantId,
      branchId,
      dateFrom: new Date('2026-08-01T00:00:00.000Z'),
      dateTo: new Date('2026-08-31T00:00:00.000Z'),
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
  });

  it('filters by status when provided', async () => {
    const reader = new InMemoryStaffReservationsReader();
    reader.seed(makeItem({ status: ReservationStatus.Approved }));
    reader.seed(
      makeItem({
        reservationId: '11111111-1111-4111-8111-111111111112',
        status: ReservationStatus.Cancelled,
      }),
    );
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      restaurantId,
      branchId,
      dateFrom: new Date('2026-08-01T00:00:00.000Z'),
      dateTo: new Date('2026-08-31T00:00:00.000Z'),
      status: ReservationStatus.Approved,
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0].status).toBe(ReservationStatus.Approved);
  });

  it('returns an empty page when the branch has no reservations in range', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      restaurantId,
      branchId,
      dateFrom: new Date('2026-08-01T00:00:00.000Z'),
      dateTo: new Date('2026-08-31T00:00:00.000Z'),
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('rejects a Customer/User actor with PermissionDeniedException', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: customerActor(),
        restaurantId,
        branchId,
        dateFrom: new Date('2026-08-01T00:00:00.000Z'),
        dateTo: new Date('2026-08-31T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an OrganizationMember actor with PermissionDeniedException (no legitimate claim to a Reservation resource)', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        restaurantId,
        branchId,
        dateFrom: new Date('2026-08-01T00:00:00.000Z'),
        dateTo: new Date('2026-08-31T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('collapses a cross-restaurant Employee to BranchNotFoundException (IDOR-safe 404)', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: employeeActor({ restaurantId: otherRestaurantId, branchIds: [] }),
        restaurantId,
        branchId,
        dateFrom: new Date('2026-08-01T00:00:00.000Z'),
        dateTo: new Date('2026-08-31T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('returns BranchNotFoundException for a genuinely nonexistent branch', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [] }),
        restaurantId,
        branchId: otherBranchId,
        dateFrom: new Date('2026-08-01T00:00:00.000Z'),
        dateTo: new Date('2026-08-31T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('rejects an Employee assigned to a different branch with EmployeeBranchNotAssignedException', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    await branchRepository.save(
      Branch.create({
        id: otherBranchId,
        restaurantId,
        city: 'Aleppo',
        district: null,
        address: '456 Side St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: null,
        timezone: 'Asia/Damascus',
        phone: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      }),
    );
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [otherBranchId] }),
        restaurantId,
        branchId,
        dateFrom: new Date('2026-08-01T00:00:00.000Z'),
        dateTo: new Date('2026-08-31T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('rejects dateFrom after dateTo with InvalidReservationDateRangeException', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [branchId] }),
        restaurantId,
        branchId,
        dateFrom: new Date('2026-08-31T00:00:00.000Z'),
        dateTo: new Date('2026-08-01T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(InvalidReservationDateRangeException);
  });

  it('rejects a range spanning more than the maximum allowed days', async () => {
    const reader = new InMemoryStaffReservationsReader();
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [branchId] }),
        restaurantId,
        branchId,
        dateFrom: new Date('2026-01-01T00:00:00.000Z'),
        dateTo: new Date('2028-01-01T00:00:00.000Z'),
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(InvalidReservationDateRangeException);
  });

  it('accepts a single-day range (dateFrom === dateTo), the Day view case', async () => {
    const reader = new InMemoryStaffReservationsReader();
    reader.seed(makeItem());
    const branchRepository = new InMemoryBranchRepository();
    await seedBranch(branchRepository);
    const useCase = makeUseCase(reader, branchRepository);

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      restaurantId,
      branchId,
      dateFrom: new Date('2026-08-10T00:00:00.000Z'),
      dateTo: new Date('2026-08-10T00:00:00.000Z'),
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
  });
});
