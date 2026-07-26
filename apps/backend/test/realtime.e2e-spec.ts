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
  REALTIME_TEST_GUEST_NAME,
  seedAdditionalFloorPlan,
  seedAdditionalTable,
  seedApprovedReservation,
  seedPendingReservation,
  seedRealtimeWorld,
  seedWaitlistEntry,
  signAccessTokenFor,
} from './helpers/realtime-fixture';

const prisma = new PrismaClient();

interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  data: Record<string, unknown>;
}

function connectSocket(url: string, token: string | undefined): Socket {
  return io(url, {
    transports: ['websocket'],
    auth: token !== undefined ? { token } : {},
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

function waitForDisconnect(socket: Socket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for disconnect')),
      timeoutMs,
    );
    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Phase 8 §10's "authentication failure must reject the connection" is
 * satisfied by `RealtimeGateway.authenticateSocket` - registered as Socket.IO
 * connection middleware (`server.use`, see realtime.gateway.ts) rather than
 * the `OnGatewayConnection` lifecycle hook, specifically so a rejection
 * (`next(error)`) surfaces as a client-side `connect_error` BEFORE the
 * `connection` event (and thus `client.data`) ever exists - closing a real
 * race where a lifecycle-hook-based rejection would otherwise let `connect`
 * fire first, briefly followed by `disconnect`. This helper accepts either
 * outcome defensively, but a healthy implementation should only ever produce
 * `connect_error` here.
 */
function waitForRejectedConnection(socket: Socket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for the connection to be rejected')),
      timeoutMs,
    );
    socket.once('connect_error', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function subscribe(
  socket: Socket,
  roomType: string,
  resourceId: string,
): Promise<{ ok: boolean; room?: string; code?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for subscribe ack')), 5000);
    socket.emit('room.subscribe', { roomType, resourceId }, (ack: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(ack as { ok: boolean; room?: string; code?: string });
    });
  });
}

function waitForDomainEvent(
  socket: Socket,
  predicate: (envelope: DomainEventEnvelope) => boolean,
  timeoutMs = 8000,
): Promise<DomainEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for domain.event')),
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

async function assertNoDomainEvent(socket: Socket, waitMs = 1500): Promise<void> {
  let received: DomainEventEnvelope | undefined;
  const handler = (envelope: DomainEventEnvelope) => {
    received = envelope;
  };
  socket.on('domain.event', handler);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  socket.off('domain.event', handler);
  expect(received).toBeUndefined();
}

/**
 * Duplicate-delivery guard for §13's "single semantic event per operation"
 * requirement - unlike `assertNoDomainEvent`, this filters by predicate
 * rather than rejecting any event at all, so it can share a socket that is
 * simultaneously awaiting the operation's own expected event (e.g. proving a
 * Reservation-owned Table release/reserve never also broadcasts a spurious
 * `TableStatusChanged` for that Table, per Phase 8 §5/ADR-023).
 */
async function assertNoMatchingDomainEvent(
  socket: Socket,
  predicate: (envelope: DomainEventEnvelope) => boolean,
  waitMs = 2500,
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
 * Phase 8 (WebSocket, architecture frozen 2026-07-24) §23 - E2E coverage
 * against a REAL, listening Nest application, the REAL Redis Socket.IO
 * adapter, a REAL `socket.io-client`, and REAL REST mutations. Covers the
 * required shape (connect -> authenticate -> subscribe -> real REST mutation
 * -> receive `domain.event`) for every §23-required event type - Approved,
 * Cancelled, Rescheduled, NoShow, WaitlistEntryPromoted, TableReadyNotified,
 * TableStatusChanged, TableMoved - plus the required authorization/
 * negative-path proofs (invalid/missing JWT, cross-branch, non-owner,
 * guest-backed-reservation, cross-organization, staff-only-event isolation).
 * Verification closure (2026-07-25): this file previously proved only
 * `ReservationApproved` end-to-end; the remaining six flows were added in
 * that closure pass - see TASKS.md's Phase 8 "Verification Closure Addendum"
 * for the before/after totals.
 */
describe('Phase 8 Realtime WebSocket (e2e)', () => {
  let stackAvailable = false;
  let app: INestApplication | undefined;
  let url = '';
  let world: RealtimeWorld;

  const originalHandshakeRateLimitMax = process.env.WS_RATE_LIMIT_HANDSHAKE_MAX;

  beforeAll(async () => {
    const [dbAvailable, redisAvailable] = await Promise.all([
      isDatabaseReachable(),
      isRedisReachable(),
    ]);
    stackAvailable = dbAvailable && redisAvailable;
    if (skipUnlessDatabaseAvailable(stackAvailable)) {
      console.warn('PostgreSQL/Redis not reachable - skipping Phase 8 e2e tests.');
      return;
    }

    // This file's own real `socket.io-client` connections (now ~25+ across
    // the full suite, sharing one real Redis-backed sliding window keyed by
    // the shared loopback IP - see `RedisSlidingWindowRateLimiter`) exceed
    // the frozen production default (`WS_RATE_LIMIT_HANDSHAKE_MAX=20`/60s,
    // realtime.config.ts) well before the suite finishes. Raised here for
    // this test process only (env-only, no production code/config change,
    // exactly the "All limits via env/config" escape valve Phase 8 §17
    // itself specifies) - mirrors `rate-limit.e2e-spec.ts`'s own established
    // precedent of overriding rate-limit envs for its own isolated app and
    // restoring them afterward.
    process.env.WS_RATE_LIMIT_HANDSHAKE_MAX = '200';

    const created = await createRealtimeTestApp();
    app = created.app;
    url = created.url;
    world = await seedRealtimeWorld(prisma);
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (stackAvailable) {
      await cleanupRealtimeWorld(prisma);
    }
    await prisma.$disconnect();
    if (originalHandshakeRateLimitMax === undefined) {
      delete process.env.WS_RATE_LIMIT_HANDSHAKE_MAX;
    } else {
      process.env.WS_RATE_LIMIT_HANDSHAKE_MAX = originalHandshakeRateLimitMax;
    }
  }, 30_000);

  function employeeToken(branchIds: string[] = [world.branchId]): string {
    return signAccessTokenFor(app!, {
      actorType: AccessTokenActorType.Employee,
      sub: world.employeeUserId,
      employeeId: randomUUID(),
      organizationId: world.organizationId,
      restaurantId: world.restaurantId,
      branchIds,
      permissions: ['reservations:approve'],
    });
  }

  function customerToken(userId: string = world.customerUserId): string {
    return signAccessTokenFor(app!, { actorType: AccessTokenActorType.User, sub: userId });
  }

  /** Generalized `employeeToken` for the new flows below, each of which needs
   * a permission other than `reservations:approve` for its own REST mutation. */
  function staffToken(permissions: string[], branchIds: string[] = [world.branchId]): string {
    return signAccessTokenFor(app!, {
      actorType: AccessTokenActorType.Employee,
      sub: world.employeeUserId,
      employeeId: randomUUID(),
      organizationId: world.organizationId,
      restaurantId: world.restaurantId,
      branchIds,
      permissions,
    });
  }

  function orgMemberToken(
    userId: string = world.orgMemberUserId,
    organizationId: string = world.organizationId,
    orgRole = 'Owner',
  ): string {
    return signAccessTokenFor(app!, {
      actorType: AccessTokenActorType.OrganizationMember,
      sub: userId,
      organizationId,
      orgRole,
    });
  }

  it('rejects a connection with an invalid JWT', async () => {
    if (!stackAvailable) return;
    const socket = connectSocket(url, 'not-a-real-jwt');
    await expect(waitForRejectedConnection(socket)).resolves.toBeUndefined();
    socket.close();
  });

  it('rejects a connection with no token at all', async () => {
    if (!stackAvailable) return;
    const socket = connectSocket(url, undefined);
    await expect(waitForRejectedConnection(socket)).resolves.toBeUndefined();
    socket.close();
  });

  it('denies room.subscribe for an Employee scoped to a different branch (cross-branch denial)', async () => {
    if (!stackAvailable) return;
    const socket = connectSocket(url, employeeToken([world.otherBranchId]));
    await waitForConnect(socket);
    const ack = await subscribe(socket, 'branch', world.branchId);
    expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    socket.close();
  });

  it('denies room.subscribe for a Customer to a reservation that is not their own (ownership denial)', async () => {
    if (!stackAvailable) return;
    const reservationId = await seedPendingReservation(prisma, world, {
      startTime: new Date('2026-12-02T18:00:00.000Z'),
      endTime: new Date('2026-12-02T19:30:00.000Z'),
    });
    const socket = connectSocket(url, customerToken(world.otherCustomerUserId));
    await waitForConnect(socket);
    const ack = await subscribe(socket, 'reservation', reservationId);
    expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    socket.close();
  });

  it('denies room.subscribe for a Customer to a guest-backed reservation (no owning User at all)', async () => {
    if (!stackAvailable) return;
    const guest = await prisma.reservationGuest.create({
      data: { fullName: REALTIME_TEST_GUEST_NAME, phone: '+963900000000' },
    });
    const tableId = await seedAdditionalTable(prisma, world);
    const reservation = await prisma.reservation.create({
      data: {
        reservationGuestId: guest.id,
        restaurantId: world.restaurantId,
        branchId: world.branchId,
        tableId,
        reservationDate: new Date('2026-12-02T00:00:00.000Z'),
        reservationStartTime: new Date('2026-12-02T18:00:00.000Z'),
        reservationEndTime: new Date('2026-12-02T19:30:00.000Z'),
        guests: 2,
        status: 'Pending',
        source: 'WalkIn',
        createdBy: world.employeeUserId,
      },
    });
    const socket = connectSocket(url, customerToken());
    await waitForConnect(socket);
    const ack = await subscribe(socket, 'reservation', reservation.id);
    expect(ack).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    socket.close();
  });

  it(
    'ReservationApproved: a real REST approve mutation broadcasts to the branch-subscribed staff socket (full payload) ' +
      'and the reservation-subscribed owning-Customer socket (PII/actor-minimized payload); an unauthorized socket receives nothing',
    async () => {
      if (!stackAvailable) return;

      const reservationId = await seedPendingReservation(prisma, world, {
        startTime: new Date('2026-12-03T18:00:00.000Z'),
        endTime: new Date('2026-12-03T19:30:00.000Z'),
      });

      const staffSocket = connectSocket(url, employeeToken());
      const customerSocket = connectSocket(url, customerToken());
      const unauthorizedSocket = connectSocket(url, employeeToken([world.otherBranchId]));

      await Promise.all([
        waitForConnect(staffSocket),
        waitForConnect(customerSocket),
        waitForConnect(unauthorizedSocket),
      ]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      const customerAck = await subscribe(customerSocket, 'reservation', reservationId);
      expect(customerAck).toEqual({ ok: true, room: `reservation:${reservationId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'ReservationApproved' && e.aggregateId === reservationId,
      );
      const customerEventPromise = waitForDomainEvent(
        customerSocket,
        (e) => e.eventType === 'ReservationApproved' && e.aggregateId === reservationId,
      );
      const unauthorizedGuard = assertNoDomainEvent(unauthorizedSocket, 2500);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${employeeToken()}`)
        .send({});
      expect(response.status).toBe(200);

      const [staffEvent, customerEvent] = await Promise.all([
        staffEventPromise,
        customerEventPromise,
      ]);
      await unauthorizedGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'ReservationApproved',
        aggregateType: 'Reservation',
        aggregateId: reservationId,
      });
      expect(typeof staffEvent.eventId).toBe('string');
      expect(new Date(staffEvent.occurredAt).toString()).not.toBe('Invalid Date');
      expect(staffEvent.data).toMatchObject({ reservationId, restaurantId: world.restaurantId });
      expect(staffEvent.data).toHaveProperty('approvedBy');

      expect(customerEvent.data).toMatchObject({ reservationId });
      expect(customerEvent.data).not.toHaveProperty('approvedBy');

      staffSocket.close();
      customerSocket.close();
      unauthorizedSocket.close();
    },
    20_000,
  );

  /**
   * Phase 8 verification closure (2026-07-25) - the six flows below close
   * the E2E gap this file's own top-of-file doc comment previously recorded:
   * each proves its own event type through a REAL REST/domain command (never
   * a direct call into `RealtimeBroadcaster`/`RealtimeEventPublisher`/the
   * event mapper), reusing this same app/world bootstrap rather than
   * duplicating it. `ReservationRescheduled` is covered separately below
   * (needs its own two-table setup).
   */
  it(
    'ReservationCancelled: a real REST cancel mutation (Approved -> Cancelled) broadcasts to the branch-subscribed staff socket ' +
      '(full payload) and the reservation-subscribed owning-Customer socket (actor-minimized payload); an unauthorized socket receives nothing',
    async () => {
      if (!stackAvailable) return;

      const tableId = await seedAdditionalTable(prisma, world);
      const reservationId = await seedApprovedReservation(prisma, world, {
        startTime: new Date('2026-12-04T18:00:00.000Z'),
        endTime: new Date('2026-12-04T19:30:00.000Z'),
        tableId,
      });

      const staffSocket = connectSocket(url, employeeToken());
      const customerSocket = connectSocket(url, customerToken());
      const unauthorizedSocket = connectSocket(url, employeeToken([world.otherBranchId]));

      await Promise.all([
        waitForConnect(staffSocket),
        waitForConnect(customerSocket),
        waitForConnect(unauthorizedSocket),
      ]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      const customerAck = await subscribe(customerSocket, 'reservation', reservationId);
      expect(customerAck).toEqual({ ok: true, room: `reservation:${reservationId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'ReservationCancelled' && e.aggregateId === reservationId,
      );
      const customerEventPromise = waitForDomainEvent(
        customerSocket,
        (e) => e.eventType === 'ReservationCancelled' && e.aggregateId === reservationId,
      );
      const unauthorizedGuard = assertNoDomainEvent(unauthorizedSocket, 2500);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${staffToken(['reservations:cancel'])}`)
        .send({ reason: 'Realtime e2e cancellation' });
      expect(response.status).toBe(200);

      const [staffEvent, customerEvent] = await Promise.all([
        staffEventPromise,
        customerEventPromise,
      ]);
      await unauthorizedGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'ReservationCancelled',
        aggregateType: 'Reservation',
        aggregateId: reservationId,
      });
      expect(staffEvent.data).toMatchObject({
        reservationId,
        restaurantId: world.restaurantId,
        branchId: world.branchId,
        tableId,
        withinCancellationWindow: false,
      });
      expect(staffEvent.data).toHaveProperty('cancelledBy');

      expect(customerEvent.data).toMatchObject({ reservationId });
      expect(customerEvent.data).not.toHaveProperty('cancelledBy');

      const dbTable = await prisma.table.findUnique({ where: { id: tableId } });
      expect(dbTable?.status).toBe('Available');
      const dbReservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
      expect(dbReservation?.status).toBe('Cancelled');

      staffSocket.close();
      customerSocket.close();
      unauthorizedSocket.close();
    },
    20_000,
  );

  it(
    'ReservationRescheduled: a real REST reschedule mutation to a different table broadcasts the old/new table sync info; ' +
      "the Table release/reserve this performs never also broadcasts a spurious TableStatusChanged (ADR-023's Reservation-owned Table operations stay Table-event-silent)",
    async () => {
      if (!stackAvailable) return;

      const oldTableId = await seedAdditionalTable(prisma, world);
      const newTableId = await seedAdditionalTable(prisma, world);
      const reservationId = await seedApprovedReservation(prisma, world, {
        startTime: new Date('2026-12-05T18:00:00.000Z'),
        endTime: new Date('2026-12-05T19:30:00.000Z'),
        tableId: oldTableId,
      });

      const staffSocket = connectSocket(url, employeeToken());
      const customerSocket = connectSocket(url, customerToken());
      await Promise.all([waitForConnect(staffSocket), waitForConnect(customerSocket)]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      const customerAck = await subscribe(customerSocket, 'reservation', reservationId);
      expect(customerAck).toEqual({ ok: true, room: `reservation:${reservationId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'ReservationRescheduled' && e.aggregateId === reservationId,
      );
      const customerEventPromise = waitForDomainEvent(
        customerSocket,
        (e) => e.eventType === 'ReservationRescheduled' && e.aggregateId === reservationId,
      );
      const noDuplicateTableStatusChangedGuard = assertNoMatchingDomainEvent(
        staffSocket,
        (e) =>
          e.eventType === 'TableStatusChanged' &&
          (e.aggregateId === oldTableId || e.aggregateId === newTableId),
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .set('Authorization', `Bearer ${staffToken(['reservations:reschedule'])}`)
        .send({ tableId: newTableId });
      expect(response.status).toBe(200);

      const [staffEvent, customerEvent] = await Promise.all([
        staffEventPromise,
        customerEventPromise,
      ]);
      await noDuplicateTableStatusChangedGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'ReservationRescheduled',
        aggregateType: 'Reservation',
        aggregateId: reservationId,
      });
      expect(staffEvent.data).toMatchObject({
        reservationId,
        restaurantId: world.restaurantId,
        branchId: world.branchId,
        oldTableId,
        newTableId,
      });
      expect(staffEvent.data).toHaveProperty('rescheduledBy');

      expect(customerEvent.data).toMatchObject({ reservationId, oldTableId, newTableId });
      expect(customerEvent.data).not.toHaveProperty('rescheduledBy');

      const dbOldTable = await prisma.table.findUnique({ where: { id: oldTableId } });
      const dbNewTable = await prisma.table.findUnique({ where: { id: newTableId } });
      expect(dbOldTable?.status).toBe('Available');
      expect(dbNewTable?.status).toBe('Reserved');
      const dbReservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
      expect(dbReservation?.tableId).toBe(newTableId);

      staffSocket.close();
      customerSocket.close();
    },
    20_000,
  );

  it(
    'ReservationNoShow: a real REST no-show mutation broadcasts to staff/customer rooms; the Table.release() this performs ' +
      'never also broadcasts a spurious TableStatusChanged for that table; an unauthorized socket receives nothing',
    async () => {
      if (!stackAvailable) return;

      const tableId = await seedAdditionalTable(prisma, world);
      const reservationId = await seedApprovedReservation(prisma, world, {
        startTime: new Date('2020-06-01T18:00:00.000Z'),
        endTime: new Date('2020-06-01T19:30:00.000Z'),
        tableId,
      });

      const staffSocket = connectSocket(url, employeeToken());
      const customerSocket = connectSocket(url, customerToken());
      const unauthorizedSocket = connectSocket(url, employeeToken([world.otherBranchId]));

      await Promise.all([
        waitForConnect(staffSocket),
        waitForConnect(customerSocket),
        waitForConnect(unauthorizedSocket),
      ]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      const customerAck = await subscribe(customerSocket, 'reservation', reservationId);
      expect(customerAck).toEqual({ ok: true, room: `reservation:${reservationId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'ReservationNoShow' && e.aggregateId === reservationId,
      );
      const customerEventPromise = waitForDomainEvent(
        customerSocket,
        (e) => e.eventType === 'ReservationNoShow' && e.aggregateId === reservationId,
      );
      const unauthorizedGuard = assertNoDomainEvent(unauthorizedSocket, 2500);
      const noDuplicateTableStatusChangedGuard = assertNoMatchingDomainEvent(
        staffSocket,
        (e) => e.eventType === 'TableStatusChanged' && e.aggregateId === tableId,
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/no-show`)
        .set('Authorization', `Bearer ${staffToken(['reservations:noshow'])}`)
        .send({});
      expect(response.status).toBe(200);

      const [staffEvent, customerEvent] = await Promise.all([
        staffEventPromise,
        customerEventPromise,
      ]);
      await unauthorizedGuard;
      await noDuplicateTableStatusChangedGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'ReservationNoShow',
        aggregateType: 'Reservation',
        aggregateId: reservationId,
      });
      expect(staffEvent.data).toMatchObject({
        reservationId,
        restaurantId: world.restaurantId,
        branchId: world.branchId,
        tableId,
      });
      expect(staffEvent.data).toHaveProperty('markedBy');

      expect(customerEvent.data).toMatchObject({ reservationId });
      expect(customerEvent.data).not.toHaveProperty('markedBy');

      const dbTable = await prisma.table.findUnique({ where: { id: tableId } });
      expect(dbTable?.status).toBe('Available');
      const dbReservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
      expect(dbReservation?.status).toBe('NoShow');

      staffSocket.close();
      customerSocket.close();
      unauthorizedSocket.close();
    },
    20_000,
  );

  it(
    'WaitlistEntryPromoted: a real manual employee promotion broadcasts to the authorized STAFF room only; ' +
      'a Customer socket is structurally denied the branch room a Waitlist event would broadcast to',
    async () => {
      if (!stackAvailable) return;

      const tableId = await seedAdditionalTable(prisma, world);
      const entryId = await seedWaitlistEntry(prisma, world, {
        preferredDate: new Date('2026-12-21T00:00:00.000Z'),
      });

      const staffSocket = connectSocket(url, employeeToken());
      const customerSocket = connectSocket(url, customerToken());
      await Promise.all([waitForConnect(staffSocket), waitForConnect(customerSocket)]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      // Waitlist events are staff-only (Phase 8 §7/§14 - no `waitlist:{id}`
      // room exists at all); a Customer is unconditionally denied the only
      // rooms a Waitlist event ever broadcasts to (organization/restaurant/
      // branch, per §8's matrix), so there is no room to legitimately
      // subscribe it into that would ever deliver one.
      const customerAck = await subscribe(customerSocket, 'branch', world.branchId);
      expect(customerAck).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'WaitlistEntryPromoted' && e.aggregateId === entryId,
      );
      const customerGuard = assertNoDomainEvent(customerSocket, 2500);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/waitlist/${entryId}/promote`)
        .set('Authorization', `Bearer ${staffToken(['reservations:waitlist'])}`)
        .send({});
      expect(response.status).toBe(200);

      const staffEvent = await staffEventPromise;
      await customerGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'WaitlistEntryPromoted',
        aggregateType: 'ReservationWaitlistEntry',
        aggregateId: entryId,
      });
      expect(staffEvent.data).toMatchObject({
        entryId,
        restaurantId: world.restaurantId,
        branchId: world.branchId,
      });
      expect(typeof staffEvent.data.convertedReservationId).toBe('string');
      expect(staffEvent.data).toHaveProperty('promotedBy');

      const dbEntry = await prisma.reservationWaitlistEntry.findUnique({ where: { id: entryId } });
      expect(dbEntry?.status).toBe('Converted');
      expect(dbEntry?.convertedReservationId).toBe(staffEvent.data.convertedReservationId);
      // autoApproval is off for this world (no RestaurantSettings row seeded)
      // - the promoted Reservation stays Pending, so the candidate Table is
      // never reserved by this flow.
      const dbTable = await prisma.table.findUnique({ where: { id: tableId } });
      expect(dbTable?.status).toBe('Available');

      staffSocket.close();
      customerSocket.close();
    },
    20_000,
  );

  it(
    'TableReadyNotified: a real POST table-ready mutation broadcasts to staff/customer rooms with a minimized customer payload; ' +
      'an unauthorized socket receives nothing',
    async () => {
      if (!stackAvailable) return;

      const tableId = await seedAdditionalTable(prisma, world);
      const reservationId = await seedApprovedReservation(prisma, world, {
        startTime: new Date('2026-12-06T18:00:00.000Z'),
        endTime: new Date('2026-12-06T19:30:00.000Z'),
        tableId,
      });

      const staffSocket = connectSocket(url, employeeToken());
      const customerSocket = connectSocket(url, customerToken());
      const unauthorizedSocket = connectSocket(url, employeeToken([world.otherBranchId]));

      await Promise.all([
        waitForConnect(staffSocket),
        waitForConnect(customerSocket),
        waitForConnect(unauthorizedSocket),
      ]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      const customerAck = await subscribe(customerSocket, 'reservation', reservationId);
      expect(customerAck).toEqual({ ok: true, room: `reservation:${reservationId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'TableReadyNotified' && e.aggregateId === reservationId,
      );
      const customerEventPromise = waitForDomainEvent(
        customerSocket,
        (e) => e.eventType === 'TableReadyNotified' && e.aggregateId === reservationId,
      );
      const unauthorizedGuard = assertNoDomainEvent(unauthorizedSocket, 2500);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/table-ready`)
        .set('Authorization', `Bearer ${staffToken(['reservations:tableready'])}`)
        .send({});
      expect(response.status).toBe(200);

      const [staffEvent, customerEvent] = await Promise.all([
        staffEventPromise,
        customerEventPromise,
      ]);
      await unauthorizedGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'TableReadyNotified',
        aggregateType: 'Reservation',
        aggregateId: reservationId,
      });
      expect(staffEvent.data).toMatchObject({
        reservationId,
        restaurantId: world.restaurantId,
        branchId: world.branchId,
      });
      expect(staffEvent.data).toHaveProperty('tableReadyNotifiedAt');
      expect(staffEvent.data).toHaveProperty('markedBy');

      expect(customerEvent.data).toMatchObject({ reservationId });
      expect(customerEvent.data).not.toHaveProperty('markedBy');

      const dbReservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
      expect(dbReservation?.status).toBe('Approved');
      expect(dbReservation?.tableReadyNotifiedAt).not.toBeNull();
      const dbTable = await prisma.table.findUnique({ where: { id: tableId } });
      expect(dbTable?.status).toBe('Reserved');

      staffSocket.close();
      customerSocket.close();
      unauthorizedSocket.close();
    },
    20_000,
  );

  it(
    'TableStatusChanged: a real manual Change Table Status mutation (OrganizationMember Owner/Admin) broadcasts the frozen ' +
      'staff-only payload; a cross-organization OrganizationMember denied the room receives nothing',
    async () => {
      if (!stackAvailable) return;

      const tableId = await seedAdditionalTable(prisma, world);

      const staffSocket = connectSocket(url, employeeToken());
      const outsiderSocket = connectSocket(
        url,
        orgMemberToken(world.otherOrgMemberUserId, world.otherOrganizationId),
      );
      await Promise.all([waitForConnect(staffSocket), waitForConnect(outsiderSocket)]);

      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });
      const outsiderAck = await subscribe(outsiderSocket, 'restaurant', world.restaurantId);
      expect(outsiderAck).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'TableStatusChanged' && e.aggregateId === tableId,
      );
      const outsiderGuard = assertNoDomainEvent(outsiderSocket, 2500);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/tables/${tableId}/status`)
        .set('Authorization', `Bearer ${orgMemberToken()}`)
        .send({ status: 'Occupied' });
      expect(response.status).toBe(200);

      const staffEvent = await staffEventPromise;
      await outsiderGuard;

      expect(staffEvent).toMatchObject({
        eventType: 'TableStatusChanged',
        aggregateType: 'Table',
        aggregateId: tableId,
      });
      expect(staffEvent.data).toMatchObject({
        tableId,
        branchId: world.branchId,
        floorPlanId: world.floorPlanId,
        organizationId: world.organizationId,
        fromStatus: 'Available',
        toStatus: 'Occupied',
        actorId: world.orgMemberUserId,
      });

      const dbTable = await prisma.table.findUnique({ where: { id: tableId } });
      expect(dbTable?.status).toBe('Occupied');

      staffSocket.close();
      outsiderSocket.close();
    },
    20_000,
  );

  it(
    'TableMoved: a real Move Table mutation (OrganizationMember Owner/Admin) broadcasts old/new floor plan sync info to the ' +
      'branch-subscribed staff socket',
    async () => {
      if (!stackAvailable) return;

      const tableId = await seedAdditionalTable(prisma, world);
      const targetFloorPlanId = await seedAdditionalFloorPlan(prisma, world);

      const staffSocket = connectSocket(url, employeeToken());
      await waitForConnect(staffSocket);
      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'TableMoved' && e.aggregateId === tableId,
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/tables/${tableId}/move`)
        .set(
          'Authorization',
          `Bearer ${orgMemberToken(world.orgMemberUserId, world.organizationId, 'Admin')}`,
        )
        .send({ targetFloorPlanId });
      expect(response.status).toBe(200);

      const staffEvent = await staffEventPromise;

      expect(staffEvent).toMatchObject({
        eventType: 'TableMoved',
        aggregateType: 'Table',
        aggregateId: tableId,
      });
      expect(staffEvent.data).toMatchObject({
        tableId,
        branchId: world.branchId,
        organizationId: world.organizationId,
        oldFloorPlanId: world.floorPlanId,
        newFloorPlanId: targetFloorPlanId,
        actorId: world.orgMemberUserId,
      });

      const dbTable = await prisma.table.findUnique({ where: { id: tableId } });
      expect(dbTable?.floorPlanId).toBe(targetFloorPlanId);

      staffSocket.close();
    },
    20_000,
  );

  it(
    'TableMerged: a real Merge Tables mutation (Employee with tables:manage) broadcasts the merge group ' +
      'sync info to the branch-subscribed staff socket, keyed to the Primary table',
    async () => {
      if (!stackAvailable) return;

      const tableA = await seedAdditionalTable(prisma, world);
      const tableB = await seedAdditionalTable(prisma, world);

      const staffSocket = connectSocket(url, employeeToken());
      await waitForConnect(staffSocket);
      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'TableMerged' && e.aggregateId === tableA,
      );

      const response = await request(app!.getHttpServer())
        .post('/api/v1/tables/merge')
        .set('Authorization', `Bearer ${staffToken(['tables:manage'])}`)
        .send({ tableIds: [tableA, tableB], primaryTableId: tableA });
      expect(response.status).toBe(200);

      const staffEvent = await staffEventPromise;

      expect(staffEvent).toMatchObject({
        eventType: 'TableMerged',
        aggregateType: 'Table',
        aggregateId: tableA,
      });
      expect(staffEvent.data).toMatchObject({
        primaryTableId: tableA,
        branchId: world.branchId,
        floorPlanId: world.floorPlanId,
        organizationId: world.organizationId,
        effectiveCapacity: 8,
      });
      expect(staffEvent.data.memberTableIds as string[]).toEqual(
        expect.arrayContaining([tableA, tableB]),
      );

      const dbPrimary = await prisma.table.findUnique({ where: { id: tableA } });
      expect(dbPrimary?.isMergePrimary).toBe(true);
      expect(dbPrimary?.status).toBe('Available');
      const dbSecondary = await prisma.table.findUnique({ where: { id: tableB } });
      expect(dbSecondary?.status).toBe('Merged');
      expect(dbSecondary?.mergeGroupId).toBe(dbPrimary?.mergeGroupId);

      staffSocket.close();
    },
    20_000,
  );

  it(
    'TableSplit: a real Split Tables mutation (OrganizationMember Owner/Admin) broadcasts the pre-split group ' +
      'membership to the branch-subscribed staff socket, keyed to the former Primary table',
    async () => {
      if (!stackAvailable) return;

      const tableA = await seedAdditionalTable(prisma, world);
      const tableB = await seedAdditionalTable(prisma, world);
      const mergeResponse = await request(app!.getHttpServer())
        .post('/api/v1/tables/merge')
        .set(
          'Authorization',
          `Bearer ${orgMemberToken(world.orgMemberUserId, world.organizationId, 'Admin')}`,
        )
        .send({ tableIds: [tableA, tableB], primaryTableId: tableA });
      expect(mergeResponse.status).toBe(200);

      const staffSocket = connectSocket(url, employeeToken());
      await waitForConnect(staffSocket);
      const staffAck = await subscribe(staffSocket, 'branch', world.branchId);
      expect(staffAck).toEqual({ ok: true, room: `branch:${world.branchId}` });

      const staffEventPromise = waitForDomainEvent(
        staffSocket,
        (e) => e.eventType === 'TableSplit' && e.aggregateId === tableA,
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/tables/${tableB}/split`)
        .set(
          'Authorization',
          `Bearer ${orgMemberToken(world.orgMemberUserId, world.organizationId, 'Admin')}`,
        )
        .send({});
      expect(response.status).toBe(200);

      const staffEvent = await staffEventPromise;

      expect(staffEvent).toMatchObject({
        eventType: 'TableSplit',
        aggregateType: 'Table',
        aggregateId: tableA,
      });
      expect(staffEvent.data).toMatchObject({
        primaryTableId: tableA,
        branchId: world.branchId,
        floorPlanId: world.floorPlanId,
        organizationId: world.organizationId,
      });
      expect(staffEvent.data).not.toHaveProperty('effectiveCapacity');
      expect(staffEvent.data.memberTableIds as string[]).toEqual(
        expect.arrayContaining([tableA, tableB]),
      );

      const dbPrimary = await prisma.table.findUnique({ where: { id: tableA } });
      expect(dbPrimary?.mergeGroupId).toBeNull();
      expect(dbPrimary?.status).toBe('Available');
      const dbSecondary = await prisma.table.findUnique({ where: { id: tableB } });
      expect(dbSecondary?.mergeGroupId).toBeNull();
      expect(dbSecondary?.status).toBe('Available');

      staffSocket.close();
    },
    20_000,
  );

  describe('JWT expiration disconnect', () => {
    const originalExpiry = process.env.JWT_ACCESS_EXPIRY;

    afterEach(() => {
      if (originalExpiry === undefined) {
        delete process.env.JWT_ACCESS_EXPIRY;
      } else {
        process.env.JWT_ACCESS_EXPIRY = originalExpiry;
      }
    });

    it('disconnects the socket once the JWT expires', async () => {
      if (!stackAvailable) return;

      process.env.JWT_ACCESS_EXPIRY = '2s';
      const { app: shortLivedApp, url: shortLivedUrl } = await createRealtimeTestApp();
      try {
        const token = signAccessTokenFor(shortLivedApp, {
          actorType: AccessTokenActorType.User,
          sub: world.customerUserId,
        });
        const socket = connectSocket(shortLivedUrl, token);
        await waitForConnect(socket);

        await expect(waitForDisconnect(socket, 8000)).resolves.toBeUndefined();
      } finally {
        await shortLivedApp.close();
      }
    }, 20_000);
  });
});
