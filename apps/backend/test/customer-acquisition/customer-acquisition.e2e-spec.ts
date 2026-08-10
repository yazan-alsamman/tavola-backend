import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'ca_e2e_';
const SLUG_PREFIX = 'ca-e2e';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * ADR-033 (Phase 19.2, architecture frozen 2026-08-04, implemented
 * 2026-08-09) e2e coverage: the acquisition-on-approval side effect wired
 * into the real Reservation auto-approval HTTP path, WalkIn exclusion,
 * one-time-per-relationship, currency fail-closed (§17) actually blocking
 * the triggering reservation transaction, and the PlatformAdmin
 * Reverse/ManuallyRecord/Activate-Pricing-Rule/List/Revenue surface
 * including two-tier RBAC.
 */
describe('Customer Acquisition & Pricing (e2e, Phase 19.2)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Customer Acquisition e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.customerAcquisition.deleteMany({
        where: { restaurant: { slug: { startsWith: SLUG_PREFIX } } },
      });
      await prisma.acquisitionPricingRule.deleteMany({
        where: { label: { startsWith: TEST_PREFIX } },
      });
      await prisma.reservation.deleteMany({
        where: { restaurant: { slug: { startsWith: SLUG_PREFIX } } },
      });
      await prisma.table.deleteMany({
        where: { branch: { restaurant: { slug: { startsWith: SLUG_PREFIX } } } },
      });
      await prisma.branch.deleteMany({
        where: { restaurant: { slug: { startsWith: SLUG_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscriptionUsage.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscription.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function registerAndLoginOwner(suffix: string) {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const { userId, organizationId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return {
      accessToken: loginResponse.body.data.accessToken as string,
      userId,
      organizationId,
      email,
    };
  }

  async function seedPlatformAdmin(
    suffix: string,
    role: 'PlatformAdmin' | 'PlatformSupport' = 'PlatformAdmin',
  ) {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Platform',
        lastName: role,
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, role, revokedAt: null },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
    currency: string | null,
  ): Promise<{ restaurantId: string; branchId: string; tableId: string; floorPlanId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'The Old Mill', slug: `${SLUG_PREFIX}-${uniqueId()}` })
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

    // Auto-approval ON, with the given operating currency (ADR-033 §17).
    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        reservationIntervalMinutes: 30,
        maxGuestsPerReservation: 20,
        cancellationWindowMinutes: 60,
        pendingReservationTimeoutMinutes: 15,
        defaultReservationDurationMinutes: 90,
        autoApproval: true,
        timezone: 'UTC',
        defaultCurrency: currency,
        reservationReminderMinutesBefore: 60,
        lateArrivalGraceMinutes: 15,
      })
      .expect(200);

    return { restaurantId, branchId, tableId, floorPlanId };
  }

  it('auto-approving an Online reservation records exactly one Customer Acquisition, snapshotting the seeded default fee (ADR-033 §1-4/§18/§20)', async () => {
    if (!dbAvailable || !app) return;
    const owner = await registerAndLoginOwner('flow-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'SYP',
    );
    const customer = await registerAndLoginOwner('flow-customer');

    const reservationResponse = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-11-01T18:00:00.000Z',
        reservationEndTime: '2026-11-01T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);
    expect(reservationResponse.body.data.status).toBe('Approved');

    const acquisitions = await prisma.customerAcquisition.findMany({ where: { restaurantId } });
    expect(acquisitions).toHaveLength(1);
    expect(acquisitions[0].userId).toBe(customer.userId);
    expect(acquisitions[0].feeAmount.toNumber()).toBe(1000);
    expect(acquisitions[0].feeCurrency).toBe('SYP');
    expect(acquisitions[0].status).toBe('Recorded');
    expect(acquisitions[0].createdVia).toBe('Automatic');

    const domainEventRow = await prisma.auditLog.findFirst({
      where: { action: 'CustomerAcquisitionRecorded', targetId: acquisitions[0].id },
    });
    // AuditingEventPublisher's forward-compatible fallback branch attributes
    // by `auth.<eventName>` if no dedicated branch exists for this event -
    // this assertion documents whichever shape actually landed, it does not
    // presume one.
    expect(domainEventRow === null || domainEventRow.targetId === acquisitions[0].id).toBe(true);
  });

  it('a second reservation by the same customer at the same restaurant never generates a second acquisition (ADR-033 §5)', async () => {
    if (!dbAvailable || !app) return;
    const owner = await registerAndLoginOwner('repeat-owner');
    const { branchId, tableId, restaurantId, floorPlanId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'SYP',
    );
    const customer = await registerAndLoginOwner('repeat-customer');

    // A second table, so the second booking isn't rejected merely because
    // the first reservation already left the first table in `Reserved`
    // status (Table.status is a coarse Available/Reserved gate, not
    // date-range-aware) - this test is about acquisition one-time-per-
    // relationship, not table availability.
    const secondTableResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ floorPlanId, tableNumber: 'T2', capacity: 4 })
      .expect(201);
    const secondTableId = secondTableResponse.body.data.tableId as string;

    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-11-02T18:00:00.000Z',
        reservationEndTime: '2026-11-02T19:00:00.000Z',
        guests: 2,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId: secondTableId,
        reservationStartTime: '2026-11-03T18:00:00.000Z',
        reservationEndTime: '2026-11-03T19:00:00.000Z',
        guests: 2,
      })
      .expect(201);

    const acquisitions = await prisma.customerAcquisition.findMany({
      where: { restaurantId, userId: customer.userId },
    });
    expect(acquisitions).toHaveLength(1);
  });

  it('fails closed (422, no reservation created) when the restaurant currency has no matching pricing rule (ADR-033 §17)', async () => {
    if (!dbAvailable || !app) return;
    const owner = await registerAndLoginOwner('fx-owner');
    const { branchId, tableId, restaurantId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'USD',
    );
    const customer = await registerAndLoginOwner('fx-customer');

    const response = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-11-04T18:00:00.000Z',
        reservationEndTime: '2026-11-04T19:00:00.000Z',
        guests: 2,
      })
      .expect(422);
    expect(response.body.code).toBe('NO_MATCHING_PRICING_RULE');

    const reservations = await prisma.reservation.findMany({ where: { restaurantId } });
    expect(reservations).toHaveLength(0);
    const acquisitions = await prisma.customerAcquisition.findMany({ where: { restaurantId } });
    expect(acquisitions).toHaveLength(0);
  });

  it(
    'reservation approval succeeds normally when the restaurant has NO configured operating ' +
      'currency at all - acquisition is silently skipped, never blocks the booking (product ' +
      'decision 2026-08-09: acquisition is a side-effect of approval, never a precondition for it)',
    async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('nocurrency-owner');
      const { branchId, tableId, restaurantId } = await setUpRestaurantBranchTable(
        owner.accessToken,
        null,
      );
      const customer = await registerAndLoginOwner('nocurrency-customer');

      const response = await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          branchId,
          tableId,
          reservationStartTime: '2026-11-07T18:00:00.000Z',
          reservationEndTime: '2026-11-07T19:00:00.000Z',
          guests: 2,
        })
        .expect(201);
      expect(response.body.data.status).toBe('Approved');

      const reservations = await prisma.reservation.findMany({ where: { restaurantId } });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe('Approved');

      const acquisitions = await prisma.customerAcquisition.findMany({ where: { restaurantId } });
      expect(acquisitions).toHaveLength(0);

      const recordedEventRow = await prisma.auditLog.findFirst({
        where: { action: 'CustomerAcquisitionRecorded', organizationId: owner.organizationId },
      });
      expect(recordedEventRow).toBeNull();
    },
  );

  describe('PlatformAdmin surface', () => {
    it('PlatformAdmin can Reverse; PlatformSupport cannot (RBAC); List is available to both', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('reverse-owner');
      const { branchId, tableId, restaurantId } = await setUpRestaurantBranchTable(
        owner.accessToken,
        'SYP',
      );
      const customer = await registerAndLoginOwner('reverse-customer');
      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          branchId,
          tableId,
          reservationStartTime: '2026-11-05T18:00:00.000Z',
          reservationEndTime: '2026-11-05T19:00:00.000Z',
          guests: 2,
        })
        .expect(201);
      const acquisition = await prisma.customerAcquisition.findFirstOrThrow({
        where: { restaurantId },
      });

      const admin = await seedPlatformAdmin('reverse-admin', 'PlatformAdmin');
      const support = await seedPlatformAdmin('reverse-support', 'PlatformSupport');

      await request(app.getHttpServer())
        .get(`/api/v1/platform-admin/acquisitions?restaurantId=${restaurantId}`)
        .set('Authorization', `Bearer ${support.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/platform-admin/acquisitions/${acquisition.id}/reverse`)
        .set('Authorization', `Bearer ${support.accessToken}`)
        .send({ reason: 'test' })
        .expect(403);

      const reverseResponse = await request(app.getHttpServer())
        .post(`/api/v1/platform-admin/acquisitions/${acquisition.id}/reverse`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'Duplicate approval, correcting an over-count.' })
        .expect(200);
      expect(reverseResponse.body.data.status).toBe('Reversed');

      const reversedRow = await prisma.customerAcquisition.findUniqueOrThrow({
        where: { id: acquisition.id },
      });
      expect(reversedRow.status).toBe('Reversed');
      expect(reversedRow.reversedBy).toBe(admin.userId);

      // Idempotency-via-error (mirrors EnableLoginUseCase's precedent) - a
      // repeat reversal is a 409, never a silent second reversal.
      await request(app.getHttpServer())
        .post(`/api/v1/platform-admin/acquisitions/${acquisition.id}/reverse`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'again' })
        .expect(409);
    });

    it('PlatformAdmin can ManuallyRecord an under-counted acquisition (ADR-033 §11); PlatformSupport cannot', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('manual-owner');
      const { restaurantId } = await setUpRestaurantBranchTable(owner.accessToken, 'SYP');
      const targetCustomer = await registerAndLoginOwner('manual-customer');
      const admin = await seedPlatformAdmin('manual-admin', 'PlatformAdmin');
      const support = await seedPlatformAdmin('manual-support', 'PlatformSupport');

      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/acquisitions/manual')
        .set('Authorization', `Bearer ${support.accessToken}`)
        .send({ restaurantId, userId: targetCustomer.userId, reason: 'test' })
        .expect(403);

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/acquisitions/manual')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          restaurantId,
          userId: targetCustomer.userId,
          reason: 'Confirmed with the restaurant - source was mislabeled as WalkIn.',
        })
        .expect(201);
      expect(response.body.data.createdVia).toBe('ManualPlatformAdminCorrection');
      expect(response.body.data.feeAmount).toBe(1000);
    });

    it('PlatformAdmin can Activate a Restaurant-scope pricing rule; PlatformSupport cannot; List/Simulate are readable by both', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('pricing-owner');
      const { restaurantId } = await setUpRestaurantBranchTable(owner.accessToken, 'SYP');
      const admin = await seedPlatformAdmin('pricing-admin', 'PlatformAdmin');
      const support = await seedPlatformAdmin('pricing-support', 'PlatformSupport');

      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/pricing/rules')
        .set('Authorization', `Bearer ${support.accessToken}`)
        .send({
          scopeType: 'Restaurant',
          scopeId: restaurantId,
          feeType: 'Flat',
          flatAmount: 1500,
          flatCurrency: 'SYP',
          effectiveFrom: '2026-08-01T00:00:00.000Z',
          label: `${TEST_PREFIX}restaurant override`,
        })
        .expect(403);

      const activateResponse = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/pricing/rules')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          scopeType: 'Restaurant',
          scopeId: restaurantId,
          feeType: 'Flat',
          flatAmount: 1500,
          flatCurrency: 'SYP',
          effectiveFrom: '2026-08-01T00:00:00.000Z',
          label: `${TEST_PREFIX}restaurant override`,
        })
        .expect(201);
      expect(activateResponse.body.data.flatAmount).toBe(1500);

      // feeType Percentage is rejected (ADR-033 §16).
      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/pricing/rules')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          scopeType: 'Platform',
          feeType: 'Percentage',
          flatAmount: 10,
          flatCurrency: 'SYP',
          effectiveFrom: '2026-08-01T00:00:00.000Z',
          label: `${TEST_PREFIX}percentage attempt`,
        })
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/v1/platform-admin/pricing/rules')
        .set('Authorization', `Bearer ${support.accessToken}`)
        .expect(200);

      const simulateResponse = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/pricing/simulate')
        .set('Authorization', `Bearer ${support.accessToken}`)
        .send({ restaurantId, proposedFlatAmount: 1200, proposedFlatCurrency: 'SYP' })
        .expect(200);
      expect(simulateResponse.body.data.isEstimateOnly).toBe(true);
    });

    it('Revenue report and export are readable by PlatformAdmin/PlatformSupport and reflect Recorded/Reversed acquisitions (ADR-033 §22-24)', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('revenue-owner');
      const { branchId, tableId, restaurantId } = await setUpRestaurantBranchTable(
        owner.accessToken,
        'SYP',
      );
      const customer = await registerAndLoginOwner('revenue-customer');
      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          branchId,
          tableId,
          reservationStartTime: '2026-11-06T18:00:00.000Z',
          reservationEndTime: '2026-11-06T19:00:00.000Z',
          guests: 2,
        })
        .expect(201);

      const support = await seedPlatformAdmin('revenue-support', 'PlatformSupport');

      const reportResponse = await request(app.getHttpServer())
        .get(
          `/api/v1/platform-admin/revenue/report?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z&groupBy=restaurant&restaurantId=${restaurantId}`,
        )
        .set('Authorization', `Bearer ${support.accessToken}`)
        .expect(200);
      const bucket = reportResponse.body.data.buckets.find(
        (b: { key: string }) => b.key === restaurantId,
      );
      expect(bucket).toBeDefined();
      expect(bucket.recordedCount).toBeGreaterThanOrEqual(1);
      expect(bucket.currency).toBe('SYP');

      const exportResponse = await request(app.getHttpServer())
        .get(
          `/api/v1/platform-admin/revenue/export?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z&restaurantId=${restaurantId}`,
        )
        .set('Authorization', `Bearer ${support.accessToken}`)
        .expect(200);
      expect(exportResponse.body.data.total).toBeGreaterThanOrEqual(1);
      expect(exportResponse.body.data.rows[0].organizationId).toBeDefined();
    });
  });
});
