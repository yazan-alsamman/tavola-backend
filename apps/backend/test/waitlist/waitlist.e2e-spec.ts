import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'waitlist-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

function isoDateDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function poll<T>(
  fn: () => Promise<T>,
  until: (value: T) => boolean,
  timeoutMs = 8000,
): Promise<T> {
  const start = Date.now();
  let value = await fn();
  while (!until(value) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await fn();
  }
  return value;
}

/**
 * Phase 7.5 (Reservation Waitlist, ADR-019, architecture frozen 2026-07-24)
 * e2e coverage: all 3 frozen endpoints (Join/Cancel/Promote), the dual-actor
 * Join/Cancel dispatch, the staff-only Promote permission gate, and the
 * durable BullMQ automatic-recheck side effect (Approved -> Cancelled frees
 * a Table, a queued serviceable entry gets promoted asynchronously).
 */
describe('/api/v1/waitlist (e2e, Phase 7.5)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let receptionistRoleId: string;
  let noWaitlistRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Waitlist e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    const manager = await prisma.role.findUniqueOrThrow({ where: { slug: 'manager' } });
    managerRoleId = manager.id;
    const receptionist = await prisma.role.findUniqueOrThrow({ where: { slug: 'receptionist' } });
    receptionistRoleId = receptionist.id;

    const noWaitlist = await prisma.role.upsert({
      where: { slug: `${TEST_PREFIX}no-waitlist` },
      update: {},
      create: {
        name: 'No Waitlist Access',
        slug: `${TEST_PREFIX}no-waitlist`,
        description: 'Test-only role with no reservations:waitlist permission',
        scope: RoleScope.Restaurant,
      },
    });
    noWaitlistRoleId = noWaitlist.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.reservationWaitlistEntry.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.reservationHistory.deleteMany({
        where: { reservation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.reservation.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      // A ReservationGuest here may also be referenced by a
      // ReservationWaitlistEntry created by another suite sharing this same
      // live Postgres instance - clear that reference first so the guest
      // delete below never trips its FK constraint.
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
      await prisma.role.deleteMany({ where: { slug: `${TEST_PREFIX}no-waitlist` } });
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

  /**
   * A genuine `AccessTokenActorType.User` (Customer) fixture - deliberately
   * NOT `registerAndLoginOwner` (that also creates an `OrganizationMember`
   * row, which resolves to actorType `OrganizationMember`, not `User`).
   * Waitlist Cancel's ownership-based authorization branch (mirroring
   * Reservation Cancel's own precedent) only special-cases `User`, so every
   * "Customer" actor here must be a bare `User` row with no
   * `Organization`/`OrganizationMember` at all.
   */
  async function registerAndLoginCustomer(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Test',
        lastName: suffix,
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return { accessToken: loginResponse.body.data.accessToken as string, userId, email };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
    tableCapacity = 4,
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
      .send({ city: 'Damascus', address: '123 Main St', countryCode: 'SY', timezone: 'UTC' })
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
      .send({ floorPlanId, tableNumber: 'T1', capacity: tableCapacity })
      .expect(201);
    const tableId = tableResponse.body.data.tableId as string;

    return { restaurantId, branchId, tableId };
  }

  async function enableAutoApproval(ownerAccessToken: string, restaurantId: string): Promise<void> {
    const current = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);

    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        reservationIntervalMinutes: current.body.data.reservationIntervalMinutes,
        maxGuestsPerReservation: current.body.data.maxGuestsPerReservation,
        cancellationWindowMinutes: current.body.data.cancellationWindowMinutes,
        pendingReservationTimeoutMinutes: current.body.data.pendingReservationTimeoutMinutes,
        defaultReservationDurationMinutes: current.body.data.defaultReservationDurationMinutes,
        autoApproval: true,
        timezone: current.body.data.timezone,
        defaultCurrency: current.body.data.defaultCurrency,
        reservationReminderMinutesBefore: current.body.data.reservationReminderMinutesBefore,
        lateArrivalGraceMinutes: current.body.data.lateArrivalGraceMinutes,
      })
      .expect(200);
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
      .send({ roleId, firstName: 'Emma', lastName: 'Ployee', email: person.email })
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

  it('a Customer joins the waitlist for themselves', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('join-owner');
    const { branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('join-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        partySize: 4,
        preferredDate: isoDateDaysFromNow(3),
        preferredTimeFrom: '19:00',
      })
      .expect(201);

    expect(response.body.data.userId).toBe(customer.userId);
    expect(response.body.data.reservationGuestId).toBeNull();
    expect(response.body.data.status).toBe('Waiting');
    expect(response.body.data.position).toBe(1);

    const row = await prisma.reservationWaitlistEntry.findUnique({
      where: { id: response.body.data.entryId },
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe('Waiting');
  });

  it('an Employee holding reservations:waitlist joins on behalf of a guest', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('join-guest-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      receptionistRoleId,
      [branchId],
    );

    const response = await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        partySize: 3,
        preferredDate: isoDateDaysFromNow(3),
        preferredTimeFrom: '19:00',
        reservationGuest: { fullName: 'Jane Guest', countryCode: 'SY', phoneNumber: '0912345678' },
      })
      .expect(201);

    expect(response.body.data.userId).toBeNull();
    expect(response.body.data.reservationGuestId).not.toBeNull();
  });

  it('an Employee lacking reservations:waitlist cannot join on behalf of a guest (403)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('join-forbidden-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      noWaitlistRoleId,
      [branchId],
    );

    await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({
        branchId,
        partySize: 2,
        preferredDate: isoDateDaysFromNow(3),
        preferredTimeFrom: '19:00',
        reservationGuest: { fullName: 'Jane Guest', countryCode: 'SY', phoneNumber: '0912345678' },
      })
      .expect(403);
  });

  it('the owning Customer cancels their own Waiting entry; a different Customer gets 404', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('cancel-owner');
    const { branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('cancel-customer');
    const otherCustomer = await registerAndLoginCustomer('cancel-other-customer');

    const joinResponse = await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        partySize: 2,
        preferredDate: isoDateDaysFromNow(3),
        preferredTimeFrom: '19:00',
      })
      .expect(201);
    const entryId = joinResponse.body.data.entryId as string;

    await request(app!.getHttpServer())
      .post(`/api/v1/waitlist/${entryId}/cancel`)
      .set('Authorization', `Bearer ${otherCustomer.accessToken}`)
      .expect(404);

    const cancelResponse = await request(app!.getHttpServer())
      .post(`/api/v1/waitlist/${entryId}/cancel`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(cancelResponse.body.data.status).toBe('Cancelled');
  });

  it('a Customer cannot manually promote (no PermissionsGuard bypass, 403)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('promote-forbidden-owner');
    const { branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('promote-forbidden-customer');

    const joinResponse = await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        partySize: 2,
        preferredDate: isoDateDaysFromNow(3),
        preferredTimeFrom: '19:00',
      })
      .expect(201);
    const entryId = joinResponse.body.data.entryId as string;

    await request(app!.getHttpServer())
      .post(`/api/v1/waitlist/${entryId}/promote`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(403);
  });

  it('a branch-scoped Employee holding reservations:waitlist manually promotes a Waiting entry into a Reservation', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('promote-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken, 4);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);
    const customer = await registerAndLoginCustomer('promote-customer');

    const joinResponse = await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        partySize: 2,
        preferredDate: isoDateDaysFromNow(3),
        preferredTimeFrom: '19:00',
      })
      .expect(201);
    const entryId = joinResponse.body.data.entryId as string;

    const promoteResponse = await request(app!.getHttpServer())
      .post(`/api/v1/waitlist/${entryId}/promote`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(promoteResponse.body.data.status).toBe('Converted');
    expect(promoteResponse.body.data.convertedReservationId).not.toBeNull();

    const reservationRow = await prisma.reservation.findUnique({
      where: { id: promoteResponse.body.data.convertedReservationId },
    });
    expect(reservationRow?.source).toBe('WaitlistConversion');
    expect(reservationRow?.userId).toBe(customer.userId);
  });

  it('automatic recheck: cancelling an Approved reservation frees the Table and the durable BullMQ job promotes the next serviceable queued entry', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('auto-recheck-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      4,
    );
    await enableAutoApproval(owner.accessToken, restaurantId);

    const bookingCustomer = await registerAndLoginCustomer('auto-recheck-booker');
    const waitingCustomer = await registerAndLoginCustomer('auto-recheck-waiter');

    const startTime = new Date(Date.now() + 5 * 86_400_000);
    startTime.setUTCHours(18, 0, 0, 0);
    const endTime = new Date(startTime.getTime() + 90 * 60_000);

    const reservationResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${bookingCustomer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: startTime.toISOString(),
        reservationEndTime: endTime.toISOString(),
        guests: 2,
      })
      .expect(201);
    expect(reservationResponse.body.data.status).toBe('Approved');

    // The automatic re-check is scoped to (branchId, preferredDate) using
    // the CANCELLED reservation's own reservationDate (Phase 7.5 §13 queue
    // scope) - the waiting entry must target the exact same calendar date
    // as the freed booking to be found by that re-check, regardless of its
    // own preferredTimeFrom (a different time-of-day on the same date is
    // fine; a different date is a different queue entirely).
    const joinResponse = await request(app!.getHttpServer())
      .post('/api/v1/waitlist')
      .set('Authorization', `Bearer ${waitingCustomer.accessToken}`)
      .send({
        branchId,
        partySize: 2,
        preferredDate: startTime.toISOString().slice(0, 10),
        preferredTimeFrom: '12:00',
      })
      .expect(201);
    const entryId = joinResponse.body.data.entryId as string;

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationResponse.body.data.reservationId}/cancel`)
      .set('Authorization', `Bearer ${bookingCustomer.accessToken}`)
      .expect(200);

    const finalEntry = await poll(
      () => prisma.reservationWaitlistEntry.findUniqueOrThrow({ where: { id: entryId } }),
      (row) => row.status !== 'Waiting',
      25000,
    );

    expect(finalEntry.status).toBe('Converted');
    expect(finalEntry.convertedReservationId).not.toBeNull();

    const promotedReservation = await prisma.reservation.findUnique({
      where: { id: finalEntry.convertedReservationId! },
    });
    expect(promotedReservation?.source).toBe('WaitlistConversion');
    expect(promotedReservation?.userId).toBe(waitingCustomer.userId);
    expect(promotedReservation?.createdBy).toBeNull();

    const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
    expect(tableRow?.status).toBe('Reserved');
  }, 30000);

  it('an entry whose requested time has already passed is not auto-promoted', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('past-time-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      4,
    );
    await enableAutoApproval(owner.accessToken, restaurantId);
    const bookingCustomer = await registerAndLoginCustomer('past-time-booker');
    const waitingCustomer = await registerAndLoginCustomer('past-time-waiter');

    const startTime = new Date(Date.now() + 5 * 86_400_000);
    startTime.setUTCHours(18, 0, 0, 0);
    const endTime = new Date(startTime.getTime() + 90 * 60_000);

    const reservationResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${bookingCustomer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: startTime.toISOString(),
        reservationEndTime: endTime.toISOString(),
        guests: 2,
      })
      .expect(201);

    // Join with a preferredDate/time that resolves into the past relative to
    // "now" is rejected at Join (validated earlier) - to reach an entry that
    // simply never becomes serviceable, seed one directly with a preferred
    // slot already behind "now" but not yet expired (its own expiration is
    // end-of-day, separate lifecycle).
    const pastPreferredDate = new Date(Date.now() - 86_400_000);
    const entry = await prisma.reservationWaitlistEntry.create({
      data: {
        id: randomUUID(),
        restaurantId,
        branchId,
        userId: waitingCustomer.userId,
        partySize: 2,
        preferredDate: pastPreferredDate,
        preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 12, 0, 0)),
        status: 'Waiting',
        position: 1,
        expiresAt: new Date(pastPreferredDate.getTime() + 86_399_999),
        createdBy: waitingCustomer.userId,
        updatedAt: new Date(),
      },
    });

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationResponse.body.data.reservationId}/cancel`)
      .set('Authorization', `Bearer ${bookingCustomer.accessToken}`)
      .expect(200);

    // Give the recheck job a moment to run (it will find this entry
    // unserviceable and, since it's the only one, do nothing).
    await new Promise((resolve) => setTimeout(resolve, 8000));

    const unchanged = await prisma.reservationWaitlistEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(unchanged.status).toBe('Waiting');
    expect(unchanged.convertedReservationId).toBeNull();
  }, 20000);
});
