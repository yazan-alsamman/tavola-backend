import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { AccessTokenActorType } from '../src/modules/authentication/domain/services/access-token-claims';
import {
  isDatabaseReachable,
  isRedisReachable,
  skipUnlessDatabaseAvailable,
} from './support/live-database';
import {
  cleanupRealtimeWorld,
  createRealtimeTestApp,
  RealtimeWorld,
  seedAdditionalTable,
  seedPendingReservation,
  seedRealtimeWorld,
  signAccessTokenFor,
} from './helpers/realtime-fixture';

const prisma = new PrismaClient();

interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  aggregateId: string;
  data: Record<string, unknown>;
}

function connectSocket(url: string, token: string): Socket {
  return io(url, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    forceNew: true,
  });
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

function subscribe(socket: Socket, roomType: string, resourceId: string): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for subscribe ack')), 5000);
    socket.emit('room.subscribe', { roomType, resourceId }, (ack: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function waitForDomainEvent(
  socket: Socket,
  predicate: (envelope: DomainEventEnvelope) => boolean,
  timeoutMs = 10000,
): Promise<DomainEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for cross-instance domain.event')),
      timeoutMs,
    );
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

/**
 * Phase 8 (WebSocket, architecture frozen 2026-07-24) §22/§28 - proves the
 * Redis Socket.IO adapter (ADR-015) actually propagates a broadcast across
 * two INDEPENDENT `INestApplication` instances (two separate Nest containers,
 * two separate HTTP listeners, each with its own `RedisIoAdapter` connected
 * to the SAME real Redis deployment) - not two connections inside one
 * process, and not a mocked adapter. This is the closest in-process
 * equivalent to "two backend Docker containers behind Nginx" that a Jest
 * integration test can construct; see the final engineering report for the
 * separate, actual-two-container Docker proof (§33).
 *
 * Instance A receives the real REST mutation (`POST .../approve`). Instance
 * B holds the only WebSocket client, subscribed to the branch room. Instance
 * B's client can only receive the resulting broadcast via Redis pub/sub -
 * there is no in-process path between the two Nest containers at all.
 */
describe('Phase 8 Realtime - Redis Socket.IO adapter cross-instance fan-out (integration)', () => {
  let stackAvailable = false;
  let instanceA: INestApplication | undefined;
  let instanceB: INestApplication | undefined;
  let urlB = '';
  let world: RealtimeWorld;

  beforeAll(async () => {
    const [dbAvailable, redisAvailable] = await Promise.all([
      isDatabaseReachable(),
      isRedisReachable(),
    ]);
    stackAvailable = dbAvailable && redisAvailable;
    if (skipUnlessDatabaseAvailable(stackAvailable)) {
      console.warn('PostgreSQL/Redis not reachable - skipping Redis adapter cross-instance test.');
      return;
    }

    const [createdA, createdB] = await Promise.all([
      createRealtimeTestApp(),
      createRealtimeTestApp(),
    ]);
    instanceA = createdA.app;
    instanceB = createdB.app;
    urlB = createdB.url;
    world = await seedRealtimeWorld(prisma);
  }, 90_000);

  afterAll(async () => {
    if (instanceA) await instanceA.close();
    if (instanceB) await instanceB.close();
    if (stackAvailable) {
      await cleanupRealtimeWorld(prisma);
    }
    await prisma.$disconnect();
  }, 30_000);

  function employeeToken(app: INestApplication, branchIds: string[] = [world.branchId]): string {
    return signAccessTokenFor(app, {
      actorType: AccessTokenActorType.Employee,
      sub: world.employeeUserId,
      employeeId: randomUUID(),
      organizationId: world.organizationId,
      restaurantId: world.restaurantId,
      branchIds,
      permissions: ['reservations:approve'],
    });
  }

  it('Instance A (real REST approve) -> Redis -> Instance B (subscribed client) receives the broadcast', async () => {
    if (!stackAvailable || !instanceA || !instanceB) return;

    const reservationId = await seedPendingReservation(prisma, world, {
      startTime: new Date('2026-12-10T18:00:00.000Z'),
      endTime: new Date('2026-12-10T19:30:00.000Z'),
    });

    const clientOnB = connectSocket(urlB, employeeToken(instanceB));
    await waitForConnect(clientOnB);
    const ack = await subscribe(clientOnB, 'branch', world.branchId);
    expect(ack.ok).toBe(true);

    const eventPromise = waitForDomainEvent(
      clientOnB,
      (e) => e.eventType === 'ReservationApproved' && e.aggregateId === reservationId,
    );

    const response = await request(instanceA.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employeeToken(instanceA)}`)
      .send({});
    expect(response.status).toBe(200);

    const event = await eventPromise;
    expect(event.aggregateId).toBe(reservationId);
    expect(event.data).toMatchObject({ reservationId, restaurantId: world.restaurantId });

    clientOnB.close();
  }, 25_000);

  it('cross-org isolation holds across instances: a client on B outside the organization never receives the event', async () => {
    if (!stackAvailable || !instanceA || !instanceB) return;

    const tableId = await seedAdditionalTable(prisma, world);
    const reservationId = await seedPendingReservation(prisma, world, {
      startTime: new Date('2026-12-11T18:00:00.000Z'),
      endTime: new Date('2026-12-11T19:30:00.000Z'),
      tableId,
    });

    const outsiderToken = signAccessTokenFor(instanceB, {
      actorType: AccessTokenActorType.OrganizationMember,
      sub: world.otherOrgMemberUserId,
      organizationId: world.otherOrganizationId,
      orgRole: 'Owner',
    });
    const outsiderClient = connectSocket(urlB, outsiderToken);
    await waitForConnect(outsiderClient);
    const ack = await subscribe(outsiderClient, 'restaurant', world.restaurantId);
    expect(ack).toMatchObject({ ok: false });

    let received: DomainEventEnvelope | undefined;
    outsiderClient.on('domain.event', (e: DomainEventEnvelope) => {
      received = e;
    });

    await request(instanceA.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employeeToken(instanceA)}`)
      .send({})
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(received).toBeUndefined();

    outsiderClient.close();
  }, 25_000);
});
