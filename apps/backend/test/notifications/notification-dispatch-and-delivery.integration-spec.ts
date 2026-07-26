import { randomUUID } from 'crypto';
import { PrismaClient, UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaNotificationRepository } from '@modules/notifications/infrastructure/persistence/prisma-notification.repository';
import { PrismaNotificationTemplateRepository } from '@modules/notifications/infrastructure/persistence/prisma-notification-template.repository';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { PrismaReservationWaitlistEntryRepository } from '@modules/waitlist/infrastructure/persistence/prisma-reservation-waitlist-entry.repository';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { NotificationDispatcher } from '@modules/notifications/application/services/notification-dispatcher.service';
import { ProcessNotificationDeliveryUseCase } from '@modules/notifications/application/use-cases/process-notification-delivery.use-case';
import { BullMqNotificationDeliveryScheduler } from '@modules/notifications/infrastructure/bullmq/bullmq-notification-delivery.scheduler';
import {
  NOTIFICATION_QUEUE_NAME,
  NotificationDeliveryJobData,
} from '@modules/notifications/infrastructure/bullmq/notification-queue.constants';
import { FakeNotificationProvider } from '@infrastructure/notifications/providers/fake/fake-notification.provider';
import {
  ReservationApprovedEvent,
  ReservationReminderDueEvent,
  ReservationReminderSentEvent,
} from '@modules/reservations/domain/events/reservation.events';
import {
  WaitlistEntryNotifiedEvent,
  WaitlistEntryPromotedEvent,
} from '@modules/waitlist/domain/events/waitlist.events';
import { ReservationWaitlistEntry } from '@modules/waitlist/domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';
import { NotificationChannel } from '@modules/notifications/domain/enums/notification.enums';
import { NotificationId } from '@shared/domain/value-objects/identifiers.vo';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import {
  isDatabaseReachable,
  isRedisReachable,
  resolveTestRedisUrl,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'notif-dispatch-delivery-';

class UuidGenerator implements IdGeneratorPort {
  generate(): string {
    return randomUUID();
  }
}

class FixedClock implements ClockPort {
  constructor(private readonly at: Date) {}
  now(): Date {
    return this.at;
  }
}

class CollectingEventPublisher implements EventPublisherPort {
  readonly events: DomainEvent[] = [];
  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
  async publishAll(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

/**
 * Phase 9 (architecture frozen 2026-07-25) - proves the full pipeline
 * against real infrastructure end to end: `NotificationDispatcher`
 * (real Postgres) -> durable `Notification` persisted -> real
 * `NotificationQueue` (BullMQ/Redis) job enqueued -> `ProcessNotificationDeliveryUseCase`
 * (real Postgres, `FakeNotificationProvider` at the provider boundary) ->
 * terminal push outcome -> the two frozen side effects
 * (`ReservationReminderSent`, `WaitlistEntryNotified` activation).
 */
describe('Notification dispatch + delivery pipeline (integration, real Postgres + real Redis)', () => {
  let dbAvailable = false;
  let redisAvailable = false;
  let notificationRepository: PrismaNotificationRepository;
  let templateRepository: PrismaNotificationTemplateRepository;
  let reservationRepository: PrismaReservationRepository;
  let waitlistEntryRepository: PrismaReservationWaitlistEntryRepository;
  let userRepository: PrismaUserRepository;
  let notificationQueue: Queue<NotificationDeliveryJobData>;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    const redisUrl = resolveTestRedisUrl();
    redisAvailable = await isRedisReachable(redisUrl);
    if (skipUnlessDatabaseAvailable(dbAvailable) || skipUnlessDatabaseAvailable(redisAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaNotificationRepository,
      PrismaNotificationTemplateRepository,
      PrismaReservationRepository,
      PrismaReservationWaitlistEntryRepository,
      PrismaUserRepository,
    ]);
    notificationRepository = moduleRef.get(PrismaNotificationRepository);
    templateRepository = moduleRef.get(PrismaNotificationTemplateRepository);
    reservationRepository = moduleRef.get(PrismaReservationRepository);
    waitlistEntryRepository = moduleRef.get(PrismaReservationWaitlistEntryRepository);
    userRepository = moduleRef.get(PrismaUserRepository);

    const parsed = new URL(redisUrl);
    notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection: {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined,
        db: Number(process.env.REDIS_QUEUE_DB_INDEX ?? '1'),
        maxRetriesPerRequest: null,
      },
    });

    org = await rawPrisma.organization.create({
      data: {
        name: 'Notification Dispatch Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });

    for (const eventType of [
      'ReservationApproved',
      'ReservationReminderDue',
      'WaitlistEntryPromoted',
    ]) {
      for (const channel of [NotificationChannel.InApp, NotificationChannel.Push]) {
        await rawPrisma.notificationTemplate.upsert({
          where: { eventType_language_channel: { eventType, language: 'en', channel } },
          create: {
            id: randomUUID(),
            eventType,
            language: 'en',
            channel,
            title: `${eventType} ${channel} title`,
            body: `${eventType} ${channel} body`,
            isDefault: true,
          },
          update: {},
        });
      }
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.notification.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await rawPrisma.reservationWaitlistEntry.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
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
      await rawPrisma.organization.deleteMany({ where: { id: org.id } });
      await rawPrisma.$disconnect();
    }
    if (redisAvailable) {
      await notificationQueue?.close();
    }
  });

  async function seedBranchWithTable(): Promise<{
    restaurantId: string;
    branchId: string;
    tableId: string;
  }> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Notification Test Bistro',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '1 Test St',
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

  async function seedUser(overrides?: { notificationOptIn?: boolean }): Promise<string> {
    const user = await rawPrisma.user.create({
      data: {
        firstName: 'Notif',
        lastName: 'Recipient',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        phone: null,
        language: 'en',
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
        notificationOptIn: overrides?.notificationOptIn ?? true,
      },
    });
    return user.id;
  }

  async function seedApprovedReservation(userId: string | null): Promise<{
    reservationId: string;
    restaurantId: string;
    branchId: string;
  }> {
    const { restaurantId, branchId, tableId } = await seedBranchWithTable();
    const reservationGuestId = userId
      ? null
      : (
          await rawPrisma.reservationGuest.create({
            data: { fullName: 'Guest', phone: `+1555${Math.floor(Math.random() * 10_000_000)}` },
          })
        ).id;
    const reservation = await rawPrisma.reservation.create({
      data: {
        userId,
        reservationGuestId,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-08-01T00:00:00.000Z'),
        reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
        reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: userId,
      },
    });
    return { reservationId: reservation.id, restaurantId, branchId };
  }

  function buildDispatcher(
    deliveryScheduler: BullMqNotificationDeliveryScheduler,
  ): NotificationDispatcher {
    return new NotificationDispatcher(
      reservationRepository,
      waitlistEntryRepository,
      userRepository,
      notificationRepository,
      templateRepository,
      deliveryScheduler,
      new FixedClock(new Date('2026-07-25T12:00:00.000Z')),
      new UuidGenerator(),
    );
  }

  it('persists a durable Notification and enqueues a real NotificationQueue job when notificationOptIn is true', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const userId = await seedUser({ notificationOptIn: true });
    const { reservationId, restaurantId, branchId } = await seedApprovedReservation(userId);
    const dispatcher = buildDispatcher(new BullMqNotificationDeliveryScheduler(notificationQueue));

    const created = await dispatcher.dispatch(
      new ReservationApprovedEvent('e1', {
        reservationId,
        restaurantId,
        branchId,
        tableId: randomUUID(),
        approvedBy: null,
        automatic: true,
      }),
    );

    expect(created).not.toBeNull();
    const notification = await notificationRepository.findById(
      NotificationId.create(created!.payload.notificationId),
    );
    expect(notification?.pushStatus).toBe('Queued');
    expect(notification?.pushIdempotencyKey).not.toBeNull();

    const job = await notificationQueue.getJob(`notification-push-${notification!.id}`);
    expect(job).toBeDefined();
    expect(job!.data.notificationId).toBe(notification!.id);
  });

  it('notificationOptIn=false persists the durable Notification but enqueues no job', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const userId = await seedUser({ notificationOptIn: false });
    const { reservationId, restaurantId, branchId } = await seedApprovedReservation(userId);
    const dispatcher = buildDispatcher(new BullMqNotificationDeliveryScheduler(notificationQueue));

    const created = await dispatcher.dispatch(
      new ReservationApprovedEvent('e1', {
        reservationId,
        restaurantId,
        branchId,
        tableId: randomUUID(),
        approvedBy: null,
        automatic: true,
      }),
    );

    expect(created).not.toBeNull();
    const notification = await notificationRepository.findById(
      NotificationId.create(created!.payload.notificationId),
    );
    expect(notification?.pushStatus).toBe('NotAttempted');

    const job = await notificationQueue.getJob(`notification-push-${notification!.id}`);
    expect(job).toBeUndefined();
  });

  it('a guest-backed source Reservation (no userId) produces no Notification at all', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const { reservationId, restaurantId, branchId } = await seedApprovedReservation(null);
    const dispatcher = buildDispatcher(new BullMqNotificationDeliveryScheduler(notificationQueue));

    const created = await dispatcher.dispatch(
      new ReservationApprovedEvent('e1', {
        reservationId,
        restaurantId,
        branchId,
        tableId: randomUUID(),
        approvedBy: null,
        automatic: true,
      }),
    );

    expect(created).toBeNull();
  });

  it('end-to-end: ReservationReminderDue -> Notification Accepted -> ReservationReminderSent published (only on Accepted)', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const userId = await seedUser({ notificationOptIn: true });
    const { reservationId, restaurantId, branchId } = await seedApprovedReservation(userId);
    const dispatcher = buildDispatcher(new BullMqNotificationDeliveryScheduler(notificationQueue));

    const created = await dispatcher.dispatch(
      new ReservationReminderDueEvent(
        'e1',
        { reservationId, restaurantId, branchId, reservationStartTime: '2026-08-01T18:00:00.000Z' },
        new Date('2026-07-25T12:00:00.000Z'),
      ),
    );
    expect(created).not.toBeNull();

    const provider = new FakeNotificationProvider();
    const eventPublisher = new CollectingEventPublisher();
    const processUseCase = new ProcessNotificationDeliveryUseCase(
      notificationRepository,
      templateRepository,
      userRepository,
      provider,
      waitlistEntryRepository,
      eventPublisher,
      new FixedClock(new Date('2026-07-25T12:05:00.000Z')),
      new UuidGenerator(),
    );

    await processUseCase.execute({
      notificationId: created!.payload.notificationId,
      isFinalAttempt: false,
    });

    const notification = await notificationRepository.findById(
      NotificationId.create(created!.payload.notificationId),
    );
    expect(notification?.pushStatus).toBe('Accepted');
    expect(notification?.pushIdempotencyKey).not.toBeNull();

    const reminderSent = eventPublisher.events.find(
      (event) => event instanceof ReservationReminderSentEvent,
    ) as ReservationReminderSentEvent | undefined;
    expect(reminderSent).toBeDefined();
    expect(reminderSent!.payload.reservationId).toBe(reservationId);
  });

  it('end-to-end: WaitlistEntryPromoted -> Notification Accepted -> Waiting transitions to Notified', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const userId = await seedUser({ notificationOptIn: true });
    const { restaurantId, branchId } = await seedBranchWithTable();

    const entry = ReservationWaitlistEntry.create({
      id: randomUUID(),
      restaurantId,
      branchId,
      userId,
      reservationGuestId: null,
      partySize: 2,
      preferredDate: new Date('2026-08-01T00:00:00.000Z'),
      preferredTimeFrom: new Date('2026-08-01T18:00:00.000Z'),
      preferredTimeTo: null,
      position: 1,
      expiresAt: new Date('2026-08-01T20:00:00.000Z'),
      notes: null,
      createdBy: userId,
      now: new Date('2026-07-25T12:00:00.000Z'),
    });
    await rawPrisma.reservationWaitlistEntry.create({
      data: {
        id: entry.id,
        restaurantId,
        branchId,
        userId,
        partySize: 2,
        preferredDate: new Date('2026-08-01T00:00:00.000Z'),
        preferredTimeFrom: new Date('2026-08-01T18:00:00.000Z'),
        status: 'Waiting',
        position: 1,
        expiresAt: new Date('2026-08-01T20:00:00.000Z'),
        createdBy: userId,
      },
    });

    const dispatcher = buildDispatcher(new BullMqNotificationDeliveryScheduler(notificationQueue));
    const created = await dispatcher.dispatch(
      new WaitlistEntryPromotedEvent(
        'e1',
        {
          entryId: entry.id,
          restaurantId,
          branchId,
          convertedReservationId: randomUUID(),
          promotedBy: null,
        },
        new Date('2026-07-25T12:00:00.000Z'),
      ),
    );
    expect(created).not.toBeNull();

    const provider = new FakeNotificationProvider();
    const eventPublisher = new CollectingEventPublisher();
    const processUseCase = new ProcessNotificationDeliveryUseCase(
      notificationRepository,
      templateRepository,
      userRepository,
      provider,
      waitlistEntryRepository,
      eventPublisher,
      new FixedClock(new Date('2026-07-25T12:05:00.000Z')),
      new UuidGenerator(),
    );
    await processUseCase.execute({
      notificationId: created!.payload.notificationId,
      isFinalAttempt: false,
    });

    const updatedEntry = await rawPrisma.reservationWaitlistEntry.findUnique({
      where: { id: entry.id },
    });
    expect(updatedEntry?.status).toBe(WaitlistStatus.Notified);

    const notifiedEvent = eventPublisher.events.find(
      (event) => event instanceof WaitlistEntryNotifiedEvent,
    );
    expect(notifiedEvent).toBeDefined();
  });

  it('never activates WaitlistEntryNotified when the push fails', async () => {
    if (!dbAvailable || !redisAvailable) return;
    const userId = await seedUser({ notificationOptIn: true });
    const { restaurantId, branchId } = await seedBranchWithTable();

    const entryId = randomUUID();
    await rawPrisma.reservationWaitlistEntry.create({
      data: {
        id: entryId,
        restaurantId,
        branchId,
        userId,
        partySize: 2,
        preferredDate: new Date('2026-08-01T00:00:00.000Z'),
        preferredTimeFrom: new Date('2026-08-01T18:00:00.000Z'),
        status: 'Waiting',
        position: 1,
        expiresAt: new Date('2026-08-01T20:00:00.000Z'),
        createdBy: userId,
      },
    });

    const dispatcher = buildDispatcher(new BullMqNotificationDeliveryScheduler(notificationQueue));
    const created = await dispatcher.dispatch(
      new WaitlistEntryPromotedEvent(
        'e1',
        { entryId, restaurantId, branchId, convertedReservationId: randomUUID(), promotedBy: null },
        new Date('2026-07-25T12:00:00.000Z'),
      ),
    );
    expect(created).not.toBeNull();

    const provider = new FakeNotificationProvider();
    provider.queueResult({ outcome: 'noRecipients' });
    const eventPublisher = new CollectingEventPublisher();
    const processUseCase = new ProcessNotificationDeliveryUseCase(
      notificationRepository,
      templateRepository,
      userRepository,
      provider,
      waitlistEntryRepository,
      eventPublisher,
      new FixedClock(new Date('2026-07-25T12:05:00.000Z')),
      new UuidGenerator(),
    );
    await processUseCase.execute({
      notificationId: created!.payload.notificationId,
      isFinalAttempt: false,
    });

    const entry = await rawPrisma.reservationWaitlistEntry.findUnique({ where: { id: entryId } });
    expect(entry?.status).toBe(WaitlistStatus.Waiting);
    expect(eventPublisher.events.some((event) => event instanceof WaitlistEntryNotifiedEvent)).toBe(
      false,
    );
  });
});
