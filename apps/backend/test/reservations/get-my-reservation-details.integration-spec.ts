import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { GetMyReservationDetailsUseCase } from '@modules/reservations/application/use-cases/get-my-reservation-details.use-case';
import { GetMyReservationUseCase } from '@modules/reservations/application/use-cases/get-my-reservation.use-case';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { RESERVATION_REPOSITORY } from '@modules/reservations/domain/repositories/reservation.repository';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { ReservationNotFoundException } from '@modules/reservations/domain/exceptions/reservation-not-found.exception';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'get-my-reservation-details-';

/**
 * Wires `GetMyReservationDetailsUseCase` -> `GetMyReservationUseCase` ->
 * `PrismaReservationRepository` through real NestJS DI against real
 * Postgres - proves the composition (actor-type gate + delegation) holds
 * end-to-end, not only against the in-memory fake used by the unit spec.
 */
describe('GetMyReservationDetailsUseCase (integration)', () => {
  let dbAvailable = false;
  let useCase: GetMyReservationDetailsUseCase;
  let org: { id: string };

  function customerActor(id: string) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function employeeActor(id: string, restaurantId: string, branchId: string) {
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

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      GetMyReservationDetailsUseCase,
      GetMyReservationUseCase,
      PrismaReservationRepository,
      { provide: RESERVATION_REPOSITORY, useExisting: PrismaReservationRepository },
    ]);
    useCase = moduleRef.get(GetMyReservationDetailsUseCase);

    org = await rawPrisma.organization.create({
      data: {
        name: 'GetMyReservationDetails Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.reservation.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.table.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.floorPlan.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedRestaurantBranchTable() {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main Floor', isActive: true },
    });
    const table = await rawPrisma.table.create({
      data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
    });
    return { restaurantId: restaurant.id, branchId: branch.id, tableId: table.id };
  }

  async function seedUser(suffix: string) {
    return rawPrisma.user.create({
      data: {
        firstName: 'Test',
        lastName: suffix,
        email: `${TEST_PREFIX}${suffix}-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  async function seedReservation(params: {
    restaurantId: string;
    branchId: string;
    tableId: string;
    userId: string;
  }) {
    return rawPrisma.reservation.create({
      data: {
        id: randomUUID(),
        userId: params.userId,
        restaurantId: params.restaurantId,
        branchId: params.branchId,
        tableId: params.tableId,
        reservationDate: new Date('2026-09-01T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-01T18:00:00.000Z'),
        reservationEndTime: new Date('2026-09-01T19:30:00.000Z'),
        guests: 2,
        status: ReservationStatus.Approved,
        source: ReservationSource.Online,
      },
    });
  }

  it("returns the caller's own reservation, full flat shape", async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser('own');
    const reservation = await seedReservation({ restaurantId, branchId, tableId, userId: user.id });

    const result = await useCase.execute({
      actor: customerActor(user.id),
      reservationId: reservation.id,
    });

    expect(result.reservationId).toBe(reservation.id);
    expect(result.restaurantId).toBe(restaurantId);
    expect(result.branchId).toBe(branchId);
    expect(result.tableId).toBe(tableId);
  });

  it("404s (IDOR-safe) for another customer's reservation", async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const owner = await seedUser('owner');
    const intruder = await seedUser('intruder');
    const reservation = await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: owner.id,
    });

    await expect(
      useCase.execute({ actor: customerActor(intruder.id), reservationId: reservation.id }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('rejects an Employee actor even when it owns the reservation', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser('employee-owner');
    const reservation = await seedReservation({ restaurantId, branchId, tableId, userId: user.id });

    await expect(
      useCase.execute({
        actor: employeeActor(user.id, restaurantId, branchId),
        reservationId: reservation.id,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });
});
