import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { PrismaClient, UserStatus } from '@prisma/client';
import { AccessTokenActorType } from '../src/modules/authentication/domain/services/access-token-claims';
import { ProcessNotificationBroadcastFanoutUseCase } from '../src/modules/notifications/application/use-cases/process-notification-broadcast-fanout.use-case';
import { isDatabaseReachable, isRedisReachable, skipUnlessDatabaseAvailable } from './support/live-database';
import {
  cleanupRealtimeWorld,
  createRealtimeTestApp,
  RealtimeWorld,
  seedRealtimeWorld,
  signAccessTokenFor,
} from './helpers/realtime-fixture';
import { hashTestPassword } from './helpers/owner-fixture';

const prisma = new PrismaClient();
const TEST_PREFIX = 'notif-broadcast-rt-e2e-';
const PASSWORD = 'SecurePass123!';

interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  data: Record<string, unknown>;
}

function connectSocket(url: string, token: string): Socket {
  return io(url, { transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true });
}

function waitForConnect(socket: Socket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for connect')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForDomainEvent(
  socket: Socket,
  predicate: (envelope: DomainEventEnvelope) => boolean,
  timeoutMs = 8000,
): Promise<DomainEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for domain.event')), timeoutMs);
    const handler = (envelope: DomainEventEnvelope) => {
      if (predicate(envelope)) {
        clearTimeout(timer);
        socket.off('domain.event', handler);
        resolve(envelope);
      }
    };
    socket.on('domain.event', handler);
  });
}

async function assertNoMatchingDomainEvent(
  socket: Socket,
  predicate: (envelope: DomainEventEnvelope) => boolean,
  waitMs = 2000,
): Promise<void> {
  let received: DomainEventEnvelope | undefined;
  const handler = (envelope: DomainEventEnvelope) => {
    if (predicate(envelope)) {
      received = envelope;
    }
  };
  socket.on('domain.event', handler);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  socket.off('domain.event', handler);
  expect(received).toBeUndefined();
}

/**
 * Phase 19.9 (ADR-037) - REAL Socket.IO client, REAL Redis adapter, REAL
 * REST mutations, against the real `user:{userId}` room this phase adds.
 * Mirrors realtime.e2e-spec.ts's established "connect -> real REST mutation
 * -> receive domain.event" shape exactly, extended to the new room. The
 * broadcast fan-out itself is driven directly via
 * `ProcessNotificationBroadcastFanoutUseCase` (resolved from the same live
 * app's DI container) rather than waiting on the real BullMQ worker to pick
 * the job up - deterministic, not reliant on worker poll timing, while still
 * emitting through the real `RealtimeBroadcasterPort`/Redis adapter/socket.io-client.
 */
describe('Internal Notification System realtime delivery (e2e, Phase 19.9)', () => {
  let stackAvailable = false;
  let app: INestApplication | undefined;
  let url = '';
  let world: RealtimeWorld;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    const [dbAvailable, redisAvailable] = await Promise.all([
      isDatabaseReachable(),
      isRedisReachable(),
    ]);
    stackAvailable = dbAvailable && redisAvailable;
    if (skipUnlessDatabaseAvailable(stackAvailable)) {
      console.warn('PostgreSQL/Redis not reachable - skipping notification realtime e2e tests.');
      return;
    }

    passwordHash = await hashTestPassword(PASSWORD);
    const created = await createRealtimeTestApp();
    app = created.app;
    url = created.url;
    world = await seedRealtimeWorld(prisma);
  }, 60_000);

  afterAll(async () => {
    if (stackAvailable) {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { user: { email: { startsWith: TEST_PREFIX } } },
            { userId: { in: [world?.customerUserId, world?.otherCustomerUserId].filter(Boolean) } },
          ],
        },
      });
      await prisma.notificationBroadcast.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
      await prisma.platformAdmin.deleteMany({ where: { user: { email: { startsWith: TEST_PREFIX } } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await cleanupRealtimeWorld(prisma);
    }
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }, 30_000);

  function customerToken(userId: string): string {
    return signAccessTokenFor(app!, { actorType: AccessTokenActorType.User, sub: userId });
  }

  async function seedPlatformAdmin(): Promise<{ accessToken: string; userId: string }> {
    const email = `${TEST_PREFIX}admin-${randomUUID().slice(0, 8)}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Platform',
        lastName: 'Admin',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, role: 'PlatformAdmin', revokedAt: null },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  it('delivers a Platform Admin -> one Customer notification only to that Customer own user room, not an unrelated Customer', async () => {
    if (!stackAvailable) return;

    const admin = await seedPlatformAdmin();
    const targetSocket = connectSocket(url, customerToken(world.customerUserId));
    const otherSocket = connectSocket(url, customerToken(world.otherCustomerUserId));
    await Promise.all([waitForConnect(targetSocket), waitForConnect(otherSocket)]);

    const eventPromise = waitForDomainEvent(
      targetSocket,
      (envelope) => envelope.eventType === 'NotificationCreated',
    );
    const noLeakPromise = assertNoMatchingDomainEvent(
      otherSocket,
      (envelope) => envelope.eventType === 'NotificationCreated',
    );

    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/notifications')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        targetUserId: world.customerUserId,
        title: `${TEST_PREFIX}Direct`,
        body: 'A direct message from the platform.',
      })
      .expect(201);

    const [envelope] = await Promise.all([eventPromise, noLeakPromise]);
    expect(envelope.data.notificationId).toBe(response.body.data.notificationId);
    expect(envelope.data).not.toHaveProperty('title');
    expect(envelope.data).not.toHaveProperty('body');

    targetSocket.close();
    otherSocket.close();
  });

  it('delivers a broadcast fan-out hint to every eligible Customer own user room in real time', async () => {
    if (!stackAvailable) return;

    // Dedicated Customers with marketingOptIn=true - world.customerUserId
    // defaults to marketingOptIn=false (schema default), which is correct
    // for a direct send but would exclude it from a broadcast audience.
    const customerA = await prisma.user.create({
      data: {
        firstName: 'Broadcast',
        lastName: 'A',
        email: `${TEST_PREFIX}bcast-a-${randomUUID()}@example.com`,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
        marketingOptIn: true,
      },
    });
    const customerB = await prisma.user.create({
      data: {
        firstName: 'Broadcast',
        lastName: 'B',
        email: `${TEST_PREFIX}bcast-b-${randomUUID()}@example.com`,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
        marketingOptIn: true,
      },
    });

    const admin = await seedPlatformAdmin();
    const socketA = connectSocket(url, customerToken(customerA.id));
    const socketB = connectSocket(url, customerToken(customerB.id));
    const unrelatedSocket = connectSocket(url, customerToken(world.otherCustomerUserId));
    await Promise.all([waitForConnect(socketA), waitForConnect(socketB), waitForConnect(unrelatedSocket)]);

    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/notifications/broadcast')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ title: `${TEST_PREFIX}Broadcast`, body: 'Broadcast body' })
      .expect(202);
    const broadcastId = response.body.data.broadcastId as string;

    const eventAPromise = waitForDomainEvent(
      socketA,
      (envelope) => envelope.eventType === 'NotificationBroadcastDelivered' && envelope.data.broadcastId === broadcastId,
    );
    const eventBPromise = waitForDomainEvent(
      socketB,
      (envelope) => envelope.eventType === 'NotificationBroadcastDelivered' && envelope.data.broadcastId === broadcastId,
    );
    const noLeakPromise = assertNoMatchingDomainEvent(
      unrelatedSocket,
      (envelope) => envelope.eventType === 'NotificationBroadcastDelivered' && envelope.data.broadcastId === broadcastId,
    );

    // Drive the fan-out deterministically via the real app's own DI-resolved
    // use case (real Postgres + real Redis-backed RealtimeBroadcasterPort),
    // rather than waiting on the live BullMQ worker's own poll timing.
    const fanoutUseCase = app!.get(ProcessNotificationBroadcastFanoutUseCase);
    await fanoutUseCase.execute({ broadcastId, isFinalAttempt: false });

    await Promise.all([eventAPromise, eventBPromise, noLeakPromise]);

    socketA.close();
    socketB.close();
    unrelatedSocket.close();
  });
});
