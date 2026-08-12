import { randomUUID } from 'crypto';
import { PrismaClient, UserStatus } from '@prisma/client';
import { PrismaNotificationBroadcastRepository } from '@modules/notifications/infrastructure/persistence/prisma-notification-broadcast.repository';
import { PrismaNotificationRepository } from '@modules/notifications/infrastructure/persistence/prisma-notification.repository';
import { PrismaCustomerAudienceReader } from '@modules/notifications/infrastructure/persistence/prisma-customer-audience.reader';
import { ProcessNotificationBroadcastFanoutUseCase } from '@modules/notifications/application/use-cases/process-notification-broadcast-fanout.use-case';
import { NotificationBroadcast } from '@modules/notifications/domain/entities/notification-broadcast.entity';
import { Notification } from '@modules/notifications/domain/entities/notification.entity';
import {
  NotificationBroadcastSenderType,
  NotificationBroadcastStatus,
} from '@modules/notifications/domain/enums/notification-broadcast.enums';
import { NotificationBroadcastId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'notif-broadcast-integration-';

describe('NotificationBroadcast / CustomerAudienceReader via real PostgreSQL (integration, Phase 19.9 ADR-037)', () => {
  let broadcastRepository: PrismaNotificationBroadcastRepository;
  let notificationRepository: PrismaNotificationRepository;
  let customerAudienceReader: PrismaCustomerAudienceReader;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaNotificationBroadcastRepository,
      PrismaNotificationRepository,
      PrismaCustomerAudienceReader,
    ]);
    broadcastRepository = moduleRef.get(PrismaNotificationBroadcastRepository);
    notificationRepository = moduleRef.get(PrismaNotificationRepository);
    customerAudienceReader = moduleRef.get(PrismaCustomerAudienceReader);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await prisma.notification.deleteMany({
      where: { user: { username: { startsWith: TEST_PREFIX } } },
    });
    await prisma.notificationBroadcast.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await prisma.employee.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.organizationMember.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.platformAdmin.deleteMany({ where: { user: { email: { startsWith: TEST_PREFIX } } } });
    await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await prisma.role.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({
      where: { OR: [{ username: { startsWith: TEST_PREFIX } }, { email: { startsWith: TEST_PREFIX } }] },
    });
    await prisma.$disconnect();
  });

  /** A bare Customer identity - phone/username, no email (ADR-022), no other actor-type row. */
  async function seedCustomer(
    overrides: Partial<{
      status: UserStatus;
      deletedAt: Date | null;
      deletionRequestedAt: Date | null;
      marketingOptIn: boolean;
    }> = {},
  ): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        username: `${TEST_PREFIX}${randomUUID()}`,
        phone: `+1555${randomUUID().replace(/-/g, '').slice(0, 7)}`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: overrides.status ?? UserStatus.Active,
        deletedAt: overrides.deletedAt ?? null,
        deletionRequestedAt: overrides.deletionRequestedAt ?? null,
        marketingOptIn: overrides.marketingOptIn ?? true,
      },
    });
    return userId;
  }

  async function seedOrganizationMemberUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
      },
    });
    const organization = await prisma.organization.create({
      data: {
        name: 'Notif Broadcast Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing@example.com`,
      },
    });
    await prisma.organizationMember.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        userId,
        role: 'Owner',
        status: 'Active',
        invitedAt: new Date(),
        joinedAt: new Date(),
      },
    });
    return userId;
  }

  async function seedEmployeeUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
      },
    });
    const organization = await prisma.organization.create({
      data: {
        name: 'Notif Broadcast Test Org (Employee)',
        slug: `${TEST_PREFIX}org-emp-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing-emp@example.com`,
      },
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'Notif Broadcast Test Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Role-${randomUUID()}`,
        slug: `${TEST_PREFIX}role-${randomUUID()}`,
        description: 'Test role',
        scope: 'Restaurant',
      },
    });
    await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        userId,
        firstName: 'Employee',
        lastName: 'Tester',
        email: `${TEST_PREFIX}employee-${randomUUID()}@example.com`,
        status: 'Active',
      },
    });
    return userId;
  }

  async function seedPlatformAdminUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, role: 'PlatformAdmin', revokedAt: null },
    });
    return userId;
  }

  // -------------------------------------------------------------------
  // PrismaNotificationBroadcastRepository
  // -------------------------------------------------------------------

  it('persists a NotificationBroadcast and reads it back with all fields intact', async () => {
    if (!dbAvailable) return;
    const broadcast = NotificationBroadcast.create({
      id: randomUUID(),
      senderType: NotificationBroadcastSenderType.PlatformAdmin,
      senderId: randomUUID(),
      organizationId: null,
      title: `${TEST_PREFIX}Title`,
      body: 'Body',
      totalRecipients: 42,
      now: new Date(),
    });

    await broadcastRepository.save(broadcast);
    const found = await broadcastRepository.findById(NotificationBroadcastId.create(broadcast.id));

    expect(found).not.toBeNull();
    expect(found?.status).toBe(NotificationBroadcastStatus.Pending);
    expect(found?.totalRecipients).toBe(42);
    expect(found?.senderType).toBe(NotificationBroadcastSenderType.PlatformAdmin);
  });

  it('persists status/counter transitions (save is a full upsert-by-id)', async () => {
    if (!dbAvailable) return;
    const now = new Date();
    let broadcast = NotificationBroadcast.create({
      id: randomUUID(),
      senderType: NotificationBroadcastSenderType.OrganizationMember,
      senderId: randomUUID(),
      organizationId: randomUUID(),
      title: `${TEST_PREFIX}Title2`,
      body: 'Body',
      totalRecipients: 10,
      now,
    });
    await broadcastRepository.save(broadcast);

    broadcast = broadcast.start(now);
    await broadcastRepository.save(broadcast);
    broadcast = broadcast.recordBatch({
      batchSize: 5,
      succeeded: 4,
      failed: 1,
      lastProcessedUserId: randomUUID(),
      at: now,
    });
    await broadcastRepository.save(broadcast);

    const found = await broadcastRepository.findById(NotificationBroadcastId.create(broadcast.id));
    expect(found?.status).toBe(NotificationBroadcastStatus.Processing);
    expect(found?.processedCount).toBe(5);
    expect(found?.succeededCount).toBe(4);
    expect(found?.failedCount).toBe(1);
    expect(found?.lastProcessedUserId?.value).toBe(broadcast.lastProcessedUserId?.value);
  });

  // -------------------------------------------------------------------
  // Notification.saveMany - idempotent batch insert under simulated retry
  // -------------------------------------------------------------------

  it('saveMany skips already-delivered rows on a retried batch via the [broadcastId, userId] unique index', async () => {
    if (!dbAvailable) return;
    const broadcastId = randomUUID();
    await prisma.notificationBroadcast.create({
      data: {
        id: broadcastId,
        senderType: 'PlatformAdmin',
        senderId: randomUUID(),
        title: `${TEST_PREFIX}SaveManyDedupe`,
        body: 'Body',
        status: 'Processing',
      },
    });
    const userA = await seedCustomer();
    const userB = await seedCustomer();
    const userC = await seedCustomer();
    const now = new Date();

    function buildFor(userId: string): Notification {
      return Notification.create({
        id: randomUUID(),
        userId,
        type: 'PlatformAdminBroadcast',
        templateId: null,
        broadcastId,
        title: 'Title',
        body: 'Body',
        data: null,
        now,
      });
    }

    const firstBatch = await notificationRepository.saveMany([buildFor(userA), buildFor(userB)]);
    expect(firstBatch.insertedCount).toBe(2);

    // Simulated retry: userA/userB re-processed (already delivered), userC is genuinely new.
    const retryBatch = await notificationRepository.saveMany([
      buildFor(userA),
      buildFor(userB),
      buildFor(userC),
    ]);
    expect(retryBatch.insertedCount).toBe(1);

    const totalRows = await prisma.notification.count({ where: { broadcastId } });
    expect(totalRows).toBe(3);
  });

  // -------------------------------------------------------------------
  // PrismaCustomerAudienceReader
  // -------------------------------------------------------------------

  describe('isEligibleCustomer', () => {
    it('is true for a genuine active Customer identity', async () => {
      if (!dbAvailable) return;
      const userId = await seedCustomer();
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(true);
    });

    it('is false for a User who is also an OrganizationMember', async () => {
      if (!dbAvailable) return;
      const userId = await seedOrganizationMemberUser();
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(false);
    });

    it('is false for a User who is also an Employee', async () => {
      if (!dbAvailable) return;
      const userId = await seedEmployeeUser();
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(false);
    });

    it('is false for a User who is also a PlatformAdmin', async () => {
      if (!dbAvailable) return;
      const userId = await seedPlatformAdminUser();
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(false);
    });

    it('is false for a non-Active account (Suspended)', async () => {
      if (!dbAvailable) return;
      const userId = await seedCustomer({ status: UserStatus.Suspended });
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(false);
    });

    it('is false for a soft-deleted account', async () => {
      if (!dbAvailable) return;
      const userId = await seedCustomer({ deletedAt: new Date() });
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(false);
    });

    it('is false for an account mid account-deletion grace period', async () => {
      if (!dbAvailable) return;
      const userId = await seedCustomer({ deletionRequestedAt: new Date() });
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(false);
    });

    it('is false for a nonexistent id', async () => {
      if (!dbAvailable) return;
      expect(await customerAudienceReader.isEligibleCustomer(randomUUID())).toBe(false);
    });

    it('does NOT require marketingOptIn (single-target send is not a marketing action)', async () => {
      if (!dbAvailable) return;
      const userId = await seedCustomer({ marketingOptIn: false });
      expect(await customerAudienceReader.isEligibleCustomer(userId)).toBe(true);
    });
  });

  describe('countBroadcastEligibleCustomers / listBroadcastEligibleCustomerBatch', () => {
    it('reflects newly-seeded eligible Customers as a delta, excluding marketingOptIn=false and non-Customer actors', async () => {
      if (!dbAvailable) return;
      const before = await customerAudienceReader.countBroadcastEligibleCustomers();

      const eligible1 = await seedCustomer({ marketingOptIn: true });
      const eligible2 = await seedCustomer({ marketingOptIn: true });
      await seedCustomer({ marketingOptIn: false }); // excluded
      await seedOrganizationMemberUser(); // excluded (not a Customer)
      await seedEmployeeUser(); // excluded (not a Customer)
      await seedPlatformAdminUser(); // excluded (not a Customer)
      await seedCustomer({ status: UserStatus.Suspended, marketingOptIn: true }); // excluded (not Active)

      const after = await customerAudienceReader.countBroadcastEligibleCustomers();
      expect(after - before).toBe(2);

      // Collect every id across keyset-paginated batches and confirm exactly
      // the two newly-eligible customers are reachable, nothing else we
      // seeded in this test leaks in.
      const collected: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 1000; i += 1) {
        const batch = await customerAudienceReader.listBroadcastEligibleCustomerBatch(cursor, 500);
        collected.push(...batch.userIds);
        if (batch.nextCursor === null) break;
        cursor = batch.nextCursor;
      }

      expect(collected).toEqual(expect.arrayContaining([eligible1, eligible2]));
      expect(collected.length).toBe(after);
    });

    it('keyset-paginates without OFFSET drift: a small batch size still reaches every eligible id across multiple pages', async () => {
      if (!dbAvailable) return;
      const seeded = await Promise.all([seedCustomer(), seedCustomer(), seedCustomer(), seedCustomer()]);

      const collected: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      for (let i = 0; i < 1000; i += 1) {
        const batch = await customerAudienceReader.listBroadcastEligibleCustomerBatch(cursor, 2);
        pages += 1;
        collected.push(...batch.userIds);
        if (batch.nextCursor === null) break;
        cursor = batch.nextCursor;
      }

      expect(pages).toBeGreaterThanOrEqual(2);
      for (const userId of seeded) {
        expect(collected).toContain(userId);
      }
      // No duplicates across pages (cursor strictly advances).
      expect(new Set(collected).size).toBe(collected.length);
    });
  });

  // -------------------------------------------------------------------
  // ProcessNotificationBroadcastFanoutUseCase - full pipeline against real
  // Postgres (audience resolution, batch insert, broadcast counters),
  // mirroring notification-dispatch-and-delivery.integration-spec.ts's
  // "drive the use case directly against real repositories" convention -
  // no live BullMQ worker needed for this assertion.
  // -------------------------------------------------------------------

  describe('ProcessNotificationBroadcastFanoutUseCase (real Postgres, fake realtime/scheduler)', () => {
    it('fans out to every eligible Customer, persists Notification rows, and completes the broadcast', async () => {
      if (!dbAvailable) return;

      const eligibleA = await seedCustomer();
      const eligibleB = await seedCustomer();
      await seedCustomer({ marketingOptIn: false }); // excluded
      await seedOrganizationMemberUser(); // excluded

      const now = new Date();
      const broadcast = NotificationBroadcast.create({
        id: randomUUID(),
        senderType: NotificationBroadcastSenderType.PlatformAdmin,
        senderId: randomUUID(),
        organizationId: null,
        title: `${TEST_PREFIX}FanoutTitle`,
        body: 'Fanout body',
        totalRecipients: null,
        now,
      });
      await broadcastRepository.save(broadcast);

      const realtimeCalls: Array<{ rooms: string[] }> = [];
      const fakeRealtimeBroadcaster = {
        broadcast: async (rooms: string[]) => {
          realtimeCalls.push({ rooms });
        },
      };
      const fakeFanoutScheduler = {
        enqueueFanout: async () => undefined,
        enqueueContinuation: async () => undefined,
      };
      const clock = { now: () => now };
      const idGenerator = { generate: () => randomUUID() };

      const useCase = new ProcessNotificationBroadcastFanoutUseCase(
        broadcastRepository,
        customerAudienceReader,
        notificationRepository,
        fakeRealtimeBroadcaster as never,
        fakeFanoutScheduler as never,
        clock as never,
        idGenerator as never,
      );

      await useCase.execute({ broadcastId: broadcast.id, isFinalAttempt: false });

      const finalBroadcast = await broadcastRepository.findById(
        NotificationBroadcastId.create(broadcast.id),
      );
      expect(finalBroadcast?.status).toBe(NotificationBroadcastStatus.Completed);
      expect(finalBroadcast?.succeededCount).toBeGreaterThanOrEqual(2);

      const notificationA = await prisma.notification.findFirst({
        where: { userId: eligibleA, broadcastId: broadcast.id },
      });
      const notificationB = await prisma.notification.findFirst({
        where: { userId: eligibleB, broadcastId: broadcast.id },
      });
      expect(notificationA).not.toBeNull();
      expect(notificationB).not.toBeNull();
      expect(notificationA?.title).toBe(`${TEST_PREFIX}FanoutTitle`);

      expect(realtimeCalls.length).toBeGreaterThan(0);
      const allRoomsBroadcast = realtimeCalls.flatMap((call) => call.rooms);
      expect(allRoomsBroadcast).toEqual(expect.arrayContaining([`user:${eligibleA}`, `user:${eligibleB}`]));
    });

    it('is idempotent under a simulated retry - re-running against an already-Completed broadcast changes nothing', async () => {
      if (!dbAvailable) return;
      const eligible = await seedCustomer();
      const now = new Date();
      let broadcast = NotificationBroadcast.create({
        id: randomUUID(),
        senderType: NotificationBroadcastSenderType.PlatformAdmin,
        senderId: randomUUID(),
        organizationId: null,
        title: `${TEST_PREFIX}IdempotentTitle`,
        body: 'Body',
        totalRecipients: null,
        now,
      });
      await broadcastRepository.save(broadcast);

      const fakeRealtimeBroadcaster = { broadcast: async () => undefined };
      const fakeFanoutScheduler = {
        enqueueFanout: async () => undefined,
        enqueueContinuation: async () => undefined,
      };
      const clock = { now: () => now };
      const idGenerator = { generate: () => randomUUID() };

      const useCase = new ProcessNotificationBroadcastFanoutUseCase(
        broadcastRepository,
        customerAudienceReader,
        notificationRepository,
        fakeRealtimeBroadcaster as never,
        fakeFanoutScheduler as never,
        clock as never,
        idGenerator as never,
      );

      await useCase.execute({ broadcastId: broadcast.id, isFinalAttempt: false });
      const countAfterFirstRun = await prisma.notification.count({
        where: { broadcastId: broadcast.id },
      });

      // Simulated stale/duplicate BullMQ job re-delivery for the same broadcast.
      await useCase.execute({ broadcastId: broadcast.id, isFinalAttempt: false });
      const countAfterSecondRun = await prisma.notification.count({
        where: { broadcastId: broadcast.id },
      });

      expect(countAfterSecondRun).toBe(countAfterFirstRun);
      expect(countAfterFirstRun).toBeGreaterThanOrEqual(1);

      const found = await prisma.notification.findFirst({
        where: { broadcastId: broadcast.id, userId: eligible },
      });
      expect(found).not.toBeNull();
    });
  });
});
