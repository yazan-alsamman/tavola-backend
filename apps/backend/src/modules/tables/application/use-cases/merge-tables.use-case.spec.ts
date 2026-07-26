import { MergeTablesUseCase } from './merge-tables.use-case';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { TableMergeConflictException } from '../../domain/exceptions/table-merge-conflict.exception';
import { InvalidTableException } from '../../domain/exceptions/invalid-table.exception';
import { TableMergedEvent } from '../../domain/events/table.events';
import { Table } from '../../domain/entities/table.entity';
import { TableShape, TableStatus } from '../../domain/enums/table.enums';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';

describe('MergeTablesUseCase', () => {
  const fixedNow = new Date('2026-07-25T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const otherOrganizationId = '33333333-3333-4333-8333-333333333399';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchId = '55555555-5555-4555-8555-555555555555';
  const floorPlanId = '66666666-6666-4666-8666-666666666666';
  const otherFloorPlanId = '66666666-6666-4666-8666-666666666699';
  const tableAId = '11111111-1111-4111-8111-111111111111';
  const tableBId = '11111111-1111-4111-8111-111111111112';
  const tableCId = '11111111-1111-4111-8111-111111111113';
  const unknownTableId = '99999999-9999-4999-8999-999999999999';

  function orgMemberActor(overrides?: { organizationId?: string; orgRole?: string }) {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: overrides?.organizationId ?? organizationId,
      orgRole: overrides?.orgRole ?? 'Owner',
      permissionsVersion: 1,
    };
  }

  function employeeActor(overrides?: { branchIds?: string[]; permissions?: string[] }) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId,
      restaurantId,
      branchIds: overrides?.branchIds ?? [branchId],
      permissions: overrides?.permissions ?? ['tables:manage'],
      permissionsVersion: 1,
    };
  }

  function table(overrides: {
    id: string;
    tableNumber: string;
    capacity?: number;
    status?: TableStatus;
    branchId?: string;
    floorPlanId?: string;
  }): Table {
    return Table.create({
      id: overrides.id,
      branchId: overrides.branchId ?? branchId,
      floorPlanId: overrides.floorPlanId ?? floorPlanId,
      tableNumber: overrides.tableNumber,
      capacity: overrides.capacity ?? 4,
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
      status: overrides.status ?? TableStatus.Available,
      mergeGroupId: null,
      isMergePrimary: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
  }

  async function build() {
    const tableRepository = new InMemoryTableRepository();
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const eventPublisher = new CollectingEventPublisher();

    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
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
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    await tableRepository.save(table({ id: tableAId, tableNumber: 'T1', capacity: 4 }));
    await tableRepository.save(table({ id: tableBId, tableNumber: 'T2', capacity: 2 }));
    await tableRepository.save(table({ id: tableCId, tableNumber: 'T3', capacity: 6 }));

    const useCase = new MergeTablesUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
      reservationRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );

    return {
      useCase,
      tableRepository,
      branchRepository,
      restaurantRepository,
      reservationRepository,
      eventPublisher,
    };
  }

  it('merges 2 Available tables, selecting the lowest tableNumber as primary when none is given', async () => {
    const { useCase, tableRepository } = await build();

    const result = await useCase.execute({
      actor: orgMemberActor(),
      tableIds: [tableBId, tableAId],
    });

    expect(result.primaryTableId).toBe(tableAId);
    expect(result.memberTableIds.sort()).toEqual([tableAId, tableBId].sort());
    expect(result.effectiveCapacity).toBe(6);

    const reloadedA = await tableRepository.findById(TableId.create(tableAId));
    const reloadedB = await tableRepository.findById(TableId.create(tableBId));
    expect(reloadedA?.isMergePrimary).toBe(true);
    expect(reloadedA?.status).toBe(TableStatus.Available);
    expect(reloadedB?.isMergePrimary).toBe(false);
    expect(reloadedB?.status).toBe(TableStatus.Merged);
    expect(reloadedA?.mergeGroupId).toBe(reloadedB?.mergeGroupId);
  });

  it('honors an explicit primaryTableId even when it is not the lowest tableNumber', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: orgMemberActor(),
      tableIds: [tableAId, tableBId, tableCId],
      primaryTableId: tableCId,
    });

    expect(result.primaryTableId).toBe(tableCId);
    expect(result.effectiveCapacity).toBe(12);
  });

  it('throws TableNotFoundException when any requested id does not exist', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: orgMemberActor(), tableIds: [tableAId, unknownTableId] }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('throws InvalidTableException when fewer than 2 distinct tables are requested', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: orgMemberActor(), tableIds: [tableAId, tableAId] }),
    ).rejects.toBeInstanceOf(InvalidTableException);
  });

  it('throws TableMergeConflictException when a table is not Available', async () => {
    const tableRepository = new InMemoryTableRepository();
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const reservationRepository = new InMemoryReservationRepository();

    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
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
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    await tableRepository.save(table({ id: tableAId, tableNumber: 'T1' }));
    await tableRepository.save(
      table({ id: tableBId, tableNumber: 'T2', status: TableStatus.Occupied }),
    );

    const useCase = new MergeTablesUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
      reservationRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );

    await expect(
      useCase.execute({ actor: orgMemberActor(), tableIds: [tableAId, tableBId] }),
    ).rejects.toBeInstanceOf(TableMergeConflictException);
  });

  it('throws TableMergeConflictException when a component has a blocking Pending/Approved reservation', async () => {
    const { useCase, reservationRepository } = await build();

    reservationRepository.seed(
      Reservation.create({
        id: '77777777-7777-4777-8777-777777777777',
        userId: 'customer-1',
        reservationGuestId: null,
        source: ReservationSource.Online,
        restaurantId,
        branchId,
        tableId: tableAId,
        reservationDate: new Date('2026-07-25T00:00:00.000Z'),
        reservationStartTime: new Date('2026-07-25T18:00:00.000Z'),
        reservationEndTime: new Date('2026-07-25T19:30:00.000Z'),
        guests: 2,
        tableCapacity: 4,
        notes: null,
        createdBy: 'customer-1',
        now: fixedNow,
      }),
    );

    await expect(
      useCase.execute({ actor: orgMemberActor(), tableIds: [tableAId, tableBId] }),
    ).rejects.toBeInstanceOf(TableMergeConflictException);
  });

  it('allows a branch-scoped Employee holding tables:manage to merge', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: employeeActor(),
      tableIds: [tableAId, tableBId],
    });

    expect(result.mergeGroupId).toBeDefined();
  });

  it('rejects an Employee without tables:manage with PermissionDeniedException', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: employeeActor({ permissions: [] }),
        tableIds: [tableAId, tableBId],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an Employee scoped to a different branch with EmployeeBranchNotAssignedException', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: ['99999999-9999-4999-8999-999999999990'] }),
        tableIds: [tableAId, tableBId],
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('rejects a non-Owner/Admin OrganizationMember with PermissionDeniedException', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: orgMemberActor({ orgRole: 'Member' }),
        tableIds: [tableAId, tableBId],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('collapses a cross-organization OrganizationMember to TableNotFoundException (IDOR-safe)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: orgMemberActor({ organizationId: otherOrganizationId }),
        tableIds: [tableAId, tableBId],
      }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('collapses a cross-organization table to TableNotFoundException even though it would otherwise fail a domain-state check first (IDOR-safe ordering)', async () => {
    // Regression test: authorization must run BEFORE
    // `TableMergeService.assertMergeable` - otherwise a foreign table that
    // would fail a domain-state check (different branch, not Available,
    // already merged) leaks a distinguishing 409 instead of collapsing to
    // the same 404 an unknown id produces.
    const { useCase, tableRepository, branchRepository, restaurantRepository } = await build();

    const otherOrgRestaurantId = '44444444-4444-4444-8444-444444444498';
    const otherOrgBranchId = '55555555-5555-4555-8555-555555555598';
    const victimTableId = '11111111-1111-4111-8111-111111111198';

    await restaurantRepository.save(
      Restaurant.create({
        id: otherOrgRestaurantId,
        organizationId: otherOrganizationId,
        name: 'Rival Bistro',
        slug: 'rival-bistro',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    await branchRepository.save(
      Branch.create({
        id: otherOrgBranchId,
        restaurantId: otherOrgRestaurantId,
        city: 'Aleppo',
        district: null,
        address: '456 Side St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: null,
        timezone: 'Asia/Damascus',
        phone: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    // Not Available - would throw a state-revealing TableMergeConflictException
    // if `assertMergeable` ran before authorization.
    await tableRepository.save(
      table({
        id: victimTableId,
        tableNumber: 'V1',
        branchId: otherOrgBranchId,
        status: TableStatus.Occupied,
      }),
    );

    await expect(
      useCase.execute({ actor: orgMemberActor(), tableIds: [tableAId, victimTableId] }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('throws TableMergeConflictException when tables span different floor plans', async () => {
    const { useCase, tableRepository } = await build();
    await tableRepository.save(
      table({ id: tableCId, tableNumber: 'T3', floorPlanId: otherFloorPlanId }),
    );

    await expect(
      useCase.execute({ actor: orgMemberActor(), tableIds: [tableAId, tableCId] }),
    ).rejects.toBeInstanceOf(TableMergeConflictException);
  });

  it('publishes a TableMergedEvent with the frozen ADR-026 payload shape only after commit', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({
      actor: orgMemberActor(),
      tableIds: [tableAId, tableBId],
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as TableMergedEvent;
    expect(event).toBeInstanceOf(TableMergedEvent);
    expect(event.eventName).toBe('TableMerged');
    expect(event.correlationId).toBe('corr-1');
    expect(event.payload).toMatchObject({
      primaryTableId: tableAId,
      branchId,
      floorPlanId,
      organizationId,
      effectiveCapacity: 6,
      actorId: 'user-1',
    });
    expect(event.payload.memberTableIds.sort()).toEqual([tableAId, tableBId].sort());
  });
});
