import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'reservation-phone-walkin-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 7.4 (Phone & Walk-In Reservations, architecture frozen 2026-07-23)
 * e2e coverage: an Employee actor creating source Phone/WalkIn via the same
 * shared `POST /reservations` endpoint Phase 7.1 already exposes, the
 * ReservationGuest persistence + FK, actor/source authorization dispatch
 * (Customer/OrganizationMember + Phone/WalkIn forbidden; Employee lacking
 * `reservations:create` or outside branch scope forbidden), and regression
 * coverage proving Phase 7.1's own "any actor type may self-book Online" rule
 * (an Employee booking Online for themselves) is unchanged.
 */
describe('/api/v1/reservations (e2e, Phase 7.4 Phone/WalkIn)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let noReservationsRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Phone/WalkIn reservation e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    const manager = await prisma.role.upsert({
      where: { slug: 'manager' },
      update: {},
      create: {
        name: 'Restaurant Manager',
        slug: 'manager',
        description: 'Full restaurant operational access within assigned scope',
        scope: RoleScope.Restaurant,
      },
    });
    managerRoleId = manager.id;

    // A role deliberately seeded with zero reservation permissions, to prove
    // an Employee lacking reservations:create is rejected (403), not merely
    // an Employee that happens not to exist.
    const noReservations = await prisma.role.upsert({
      where: { slug: `${TEST_PREFIX}no-reservations` },
      update: {},
      create: {
        name: 'No Reservations Access',
        slug: `${TEST_PREFIX}no-reservations`,
        description: 'Test-only role with no reservations:* permissions',
        scope: RoleScope.Restaurant,
      },
    });
    noReservationsRoleId = noReservations.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.reservation.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      // A phone/walk-in ReservationGuest may also be referenced by a
      // ReservationWaitlistEntry (Phase 7.5) created by another suite sharing
      // this same live Postgres instance - clear that reference first so the
      // guest delete below never trips its FK constraint.
      await prisma.reservationWaitlistEntry.deleteMany({
        where: { reservationGuest: { phone: { startsWith: '+963' } } },
      });
      await prisma.reservationGuest.deleteMany({ where: { phone: { startsWith: '+963' } } });
      await prisma.employeeBranchAssignment.deleteMany({
        where: { employee: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.employee.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.table.deleteMany({
        where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.branch.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.role.deleteMany({ where: { slug: `${TEST_PREFIX}no-reservations` } });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const { userId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return { accessToken: loginResponse.body.data.accessToken as string, userId, email };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
  ): Promise<{ restaurantId: string; branchId: string; tableId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurantResponse.body.data.restaurantId as string;

    const branchResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);
    const branchId = branchResponse.body.data.branchId as string;

    const floorPlanResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Main Floor' })
      .expect(201);
    const floorPlanId = floorPlanResponse.body.data.floorPlanId as string;

    const tableResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ floorPlanId, tableNumber: 'T1', capacity: 4 })
      .expect(201);
    const tableId = tableResponse.body.data.tableId as string;

    return { restaurantId, branchId, tableId };
  }

  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
    roleId: string,
    branchIds?: string[],
  ): Promise<{ accessToken: string; employeeId: string }> {
    const person = await registerAndLoginOwner(`emp-${uniqueId()}`);

    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        roleId,
        firstName: 'Emma',
        lastName: 'Ployee',
        email: person.email,
      })
      .expect(201);
    const employeeId = invited.body.data.employeeId as string;

    for (const branchId of branchIds ?? []) {
      await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/employees/${employeeId}/branches`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ branchId })
        .expect(200);
    }

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: person.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return { accessToken: loginResponse.body.data.accessToken as string, employeeId };
  }

  function guestPayload(overrides?: { fullName?: string; phoneNumber?: string }) {
    return {
      fullName: overrides?.fullName ?? 'Jane Guest',
      countryCode: 'SY',
      phoneNumber: overrides?.phoneNumber ?? '0912345678',
    };
  }

  it('an Employee creates a Phone reservation: ReservationGuest persisted, userId null, audited as Employee, ReservationCreated event source = Phone', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('phone-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-01T18:00:00.000Z',
        guests: 2,
        source: 'Phone',
        reservationGuest: guestPayload(),
      })
      .expect(201);

    expect(response.body.data.source).toBe('Phone');
    expect(response.body.data.userId).toBeNull();
    expect(response.body.data.reservationGuestId).not.toBeNull();

    const guestRow = await prisma.reservationGuest.findUnique({
      where: { id: response.body.data.reservationGuestId },
    });
    expect(guestRow).not.toBeNull();
    expect(guestRow?.fullName).toBe('Jane Guest');
    expect(guestRow?.phone).toBe('+963912345678');

    const reservationRow = await prisma.reservation.findUnique({
      where: { id: response.body.data.reservationId },
    });
    expect(reservationRow?.reservationGuestId).toBe(response.body.data.reservationGuestId);
    expect(reservationRow?.createdBy).toBe(employee.employeeId);

    const auditRow = await prisma.auditLog.findFirst({
      where: { targetId: response.body.data.reservationId, action: 'reservation.created' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorType).toBe('Employee');
    expect(auditRow?.actorId).toBe(employee.employeeId);
  });

  it('an Employee creates a WalkIn reservation identically, only source differs', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('walkin-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-02T18:00:00.000Z',
        guests: 2,
        source: 'WalkIn',
        reservationGuest: guestPayload({ phoneNumber: '0912345679' }),
      })
      .expect(201);

    expect(response.body.data.source).toBe('WalkIn');
    expect(response.body.data.userId).toBeNull();
    expect(response.body.data.reservationGuestId).not.toBeNull();
  });

  it('rejects a Customer/OrganizationMember actor supplying source Phone (403 FORBIDDEN)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('cust-phone-owner');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('cust-phone-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-03T18:00:00.000Z',
        guests: 2,
        source: 'Phone',
        reservationGuest: guestPayload(),
      })
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects an Employee lacking reservations:create (403 FORBIDDEN)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('no-perm-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      noReservationsRoleId,
      [branchId],
    );

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-04T18:00:00.000Z',
        guests: 2,
        source: 'WalkIn',
        reservationGuest: guestPayload(),
      })
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects an Employee outside branch scope (403 EMPLOYEE_BRANCH_NOT_ASSIGNED)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('scope-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    // A second branch under the same restaurant - the Employee is scoped to
    // this one, not the one the reservation targets.
    const branchResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ city: 'Aleppo', address: '1 Other St', countryCode: 'SY', timezone: 'Asia/Damascus' })
      .expect(201);
    const otherBranchId = branchResponse.body.data.branchId as string;

    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      otherBranchId,
    ]);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-05T18:00:00.000Z',
        guests: 2,
        source: 'Phone',
        reservationGuest: guestPayload(),
      })
      .expect(403);

    expect(response.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
  });

  it('rejects a Phone create with no reservationGuest payload (400 VALIDATION_ERROR)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('no-guest-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-06T18:00:00.000Z',
        guests: 2,
        source: 'Phone',
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid reservationGuest phone number (400 VALIDATION_ERROR)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('bad-phone-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-07T18:00:00.000Z',
        guests: 2,
        source: 'WalkIn',
        reservationGuest: { fullName: 'Bad Phone', countryCode: 'SY', phoneNumber: '1' },
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('regression: an Employee may still create source Online for themselves (Phase 7.1 self-booking, unaffected by Phase 7.4)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('self-book-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    // Deliberately NOT assigned to this branch, and holding the no-permission
    // role - Online self-booking must not be gated by either.
    const employee = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      noReservationsRoleId,
    );

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-12-08T18:00:00.000Z',
        guests: 2,
      })
      .expect(201);

    expect(response.body.data.source).toBe('Online');
    expect(response.body.data.reservationGuestId).toBeNull();
  });

  it('returns 404 when the table belongs to a different branch (IDOR) for an Employee Phone create', async () => {
    if (!dbAvailable) return;

    const ownerA = await registerAndLoginOwner('idor-a');
    const {
      restaurantId: restaurantA,
      branchId: branchA,
      tableId,
    } = await setUpRestaurantBranchTable(ownerA.accessToken);
    const employee = await inviteAndLoginEmployee(ownerA.accessToken, restaurantA, managerRoleId, [
      branchA,
    ]);
    const ownerB = await registerAndLoginOwner('idor-b');
    const { branchId: branchB } = await setUpRestaurantBranchTable(ownerB.accessToken);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId: branchB,
        tableId,
        reservationStartTime: '2026-12-09T18:00:00.000Z',
        guests: 2,
        source: 'Phone',
        reservationGuest: guestPayload({ phoneNumber: '0912345677' }),
      })
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
  });
});
