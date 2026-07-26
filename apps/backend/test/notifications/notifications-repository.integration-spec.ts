import { randomUUID } from 'crypto';
import { PrismaClient, UserStatus } from '@prisma/client';
import { PrismaNotificationRepository } from '@modules/notifications/infrastructure/persistence/prisma-notification.repository';
import { PrismaNotificationTemplateRepository } from '@modules/notifications/infrastructure/persistence/prisma-notification-template.repository';
import { Notification } from '@modules/notifications/domain/entities/notification.entity';
import { NotificationChannel } from '@modules/notifications/domain/enums/notification.enums';
import { NotificationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'notifications-repo-integration-';

describe('Notification/NotificationTemplate persistence via real PostgreSQL (integration)', () => {
  let notificationRepository: PrismaNotificationRepository;
  let templateRepository: PrismaNotificationTemplateRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaNotificationRepository,
      PrismaNotificationTemplateRepository,
    ]);
    notificationRepository = moduleRef.get(PrismaNotificationRepository);
    templateRepository = moduleRef.get(PrismaNotificationTemplateRepository);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await prisma.notification.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.notificationTemplate.deleteMany({
      where: { eventType: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Notif',
        lastName: 'Tester',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        phone: null,
        language: 'en',
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return userId;
  }

  function buildNotification(userId: string, overrides?: { now?: Date }): Notification {
    return Notification.create({
      id: randomUUID(),
      userId,
      type: 'ReservationApproved',
      templateId: null,
      title: 'Reservation confirmed',
      body: 'Your reservation has been confirmed.',
      data: { reservationId: randomUUID() },
      now: overrides?.now ?? new Date(),
    });
  }

  it('persists a Notification and reads it back with all fields intact', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const notification = buildNotification(userId);

    await notificationRepository.save(notification);
    const found = await notificationRepository.findById(NotificationId.create(notification.id));

    expect(found).not.toBeNull();
    expect(found?.userId.value).toBe(userId);
    expect(found?.title).toBe('Reservation confirmed');
    expect(found?.data).toEqual(notification.data);
    expect(found?.read).toBe(false);
    expect(found?.pushStatus).toBe('NotAttempted');
  });

  it('persists push-track transitions (save is a full upsert-by-id)', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const now = new Date();
    const idempotencyKey = randomUUID();
    const notification = buildNotification(userId, { now }).enqueuePush(idempotencyKey, now);
    await notificationRepository.save(notification);

    const accepted = notification.recordPushAccepted('provider-msg-1', now);
    await notificationRepository.save(accepted);

    const found = await notificationRepository.findById(NotificationId.create(notification.id));
    expect(found?.pushStatus).toBe('Accepted');
    expect(found?.pushProviderMessageId).toBe('provider-msg-1');
    expect(found?.pushIdempotencyKey).toBe(idempotencyKey);
  });

  it('lists a user own notifications ordered newest-first, with pagination', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const older = buildNotification(userId, { now: new Date('2026-07-01T00:00:00.000Z') });
    const newer = buildNotification(userId, { now: new Date('2026-07-10T00:00:00.000Z') });
    await notificationRepository.save(older);
    await notificationRepository.save(newer);

    const page = await notificationRepository.listByUser(UserId.create(userId), 1, 20, {
      unreadOnly: false,
    });

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it('filters to unread only when requested', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser();
    const unread = buildNotification(userId);
    const read = buildNotification(userId).markRead(new Date());
    await notificationRepository.save(unread);
    await notificationRepository.save(read);

    const page = await notificationRepository.listByUser(UserId.create(userId), 1, 20, {
      unreadOnly: true,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(unread.id);
  });

  it('markAllReadByUser marks every unread notification read in one operation, scoped to that user', async () => {
    if (!dbAvailable) return;
    const userA = await seedUser();
    const userB = await seedUser();
    await notificationRepository.save(buildNotification(userA));
    await notificationRepository.save(buildNotification(userA));
    await notificationRepository.save(buildNotification(userB));

    await notificationRepository.markAllReadByUser(UserId.create(userA), new Date());

    const countA = await notificationRepository.countUnreadByUser(UserId.create(userA));
    const countB = await notificationRepository.countUnreadByUser(UserId.create(userB));
    expect(countA).toBe(0);
    expect(countB).toBe(1);
  });

  it('countUnreadByUser reflects only that user own unread notifications (no cross-user leakage)', async () => {
    if (!dbAvailable) return;
    const userA = await seedUser();
    const userB = await seedUser();
    await notificationRepository.save(buildNotification(userA));
    await notificationRepository.save(buildNotification(userA));
    await notificationRepository.save(buildNotification(userB));

    expect(await notificationRepository.countUnreadByUser(UserId.create(userA))).toBe(2);
    expect(await notificationRepository.countUnreadByUser(UserId.create(userB))).toBe(1);
  });

  it("listByUser never returns another user's notifications", async () => {
    if (!dbAvailable) return;
    const userA = await seedUser();
    const userB = await seedUser();
    await notificationRepository.save(buildNotification(userA));

    const pageB = await notificationRepository.listByUser(UserId.create(userB), 1, 20, {
      unreadOnly: false,
    });

    expect(pageB.total).toBe(0);
  });

  // -------------------------------------------------------------------
  // NotificationTemplate
  // -------------------------------------------------------------------

  async function seedTemplate(overrides: {
    eventType: string;
    language: string;
    channel: NotificationChannel;
    isDefault: boolean;
  }): Promise<void> {
    await prisma.notificationTemplate.create({
      data: {
        id: randomUUID(),
        eventType: overrides.eventType,
        language: overrides.language,
        channel: overrides.channel,
        title: `${overrides.language} title`,
        body: `${overrides.language} body`,
        isDefault: overrides.isDefault,
      },
    });
  }

  it('findExact resolves the exact (eventType, language, channel) row', async () => {
    if (!dbAvailable) return;
    const eventType = `${TEST_PREFIX}Event1`;
    await seedTemplate({
      eventType,
      language: 'en',
      channel: NotificationChannel.InApp,
      isDefault: true,
    });
    await seedTemplate({
      eventType,
      language: 'fr',
      channel: NotificationChannel.InApp,
      isDefault: false,
    });

    const found = await templateRepository.findExact(eventType, 'fr', NotificationChannel.InApp);

    expect(found).not.toBeNull();
    expect(found?.language).toBe('fr');
  });

  it('findExact returns null when no exact-language row exists', async () => {
    if (!dbAvailable) return;
    const eventType = `${TEST_PREFIX}Event2`;
    await seedTemplate({
      eventType,
      language: 'en',
      channel: NotificationChannel.InApp,
      isDefault: true,
    });

    const found = await templateRepository.findExact(eventType, 'de', NotificationChannel.InApp);

    expect(found).toBeNull();
  });

  it('findDefault resolves the isDefault row for a (eventType, channel) pair', async () => {
    if (!dbAvailable) return;
    const eventType = `${TEST_PREFIX}Event3`;
    await seedTemplate({
      eventType,
      language: 'en',
      channel: NotificationChannel.Push,
      isDefault: true,
    });
    await seedTemplate({
      eventType,
      language: 'fr',
      channel: NotificationChannel.Push,
      isDefault: false,
    });

    const found = await templateRepository.findDefault(eventType, NotificationChannel.Push);

    expect(found).not.toBeNull();
    expect(found?.language).toBe('en');
    expect(found?.isDefault).toBe(true);
  });

  it('Push and InApp templates for the same (eventType, language) carry independent content', async () => {
    if (!dbAvailable) return;
    const eventType = `${TEST_PREFIX}Event4`;
    await prisma.notificationTemplate.create({
      data: {
        id: randomUUID(),
        eventType,
        language: 'en',
        channel: NotificationChannel.InApp,
        title: 'In-App title',
        body: 'In-App body',
        isDefault: true,
      },
    });
    await prisma.notificationTemplate.create({
      data: {
        id: randomUUID(),
        eventType,
        language: 'en',
        channel: NotificationChannel.Push,
        title: 'Push title',
        body: 'Push body',
        isDefault: true,
      },
    });

    const inApp = await templateRepository.findExact(eventType, 'en', NotificationChannel.InApp);
    const push = await templateRepository.findExact(eventType, 'en', NotificationChannel.Push);

    expect(inApp?.title).toBe('In-App title');
    expect(push?.title).toBe('Push title');
  });
});
