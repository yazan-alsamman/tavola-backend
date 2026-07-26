/* eslint-disable no-console */
/**
 * Phase 8 §32 — live verification through the production-style Nginx
 * `/socket.io/` proxy, against the freshly rebuilt, force-recreated
 * `tavla-backend-1` Docker container (real Redis, real Postgres, real
 * Socket.IO, real REST). Run manually (`npx tsx scripts/phase8-live-nginx-verify.ts`)
 * after `docker compose up` — not part of the automated test suite.
 *
 * Obtains a "real" JWT by signing one locally with the exact same HS256
 * secret/issuer/audience/claim-shape `JwtTokenService.signAccessToken` uses
 * (read from .env.development) rather than driving the full OTP-gated
 * customer registration/login HTTP flow (which requires a real LightOTP
 * WhatsApp delivery this environment cannot receive) — the resulting token
 * is byte-for-byte what the real issuer would have produced and is verified
 * by the live container's own `JwtTokenService.verifyAccessToken` exactly as
 * any other token would be.
 */
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';

const NGINX_BASE_URL = 'http://localhost:80';
const JWT_SECRET = 'tavla_dev_jwt_access_secret_min_32_chars';
const JWT_ISSUER = 'tavla-api';
const JWT_AUDIENCE = 'tavla-clients';
const DATABASE_URL =
  'postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public';
const PREFIX = 'phase8-live-';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

function sign(claims: Record<string, unknown>): string {
  return jwt.sign(claims, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    keyid: 'current',
  });
}

function employeeToken(input: {
  sub: string;
  employeeId: string;
  organizationId: string;
  restaurantId: string;
  branchIds: string[];
}): string {
  return sign({
    sub: input.sub,
    actorType: 'Employee',
    sessionId: randomUUID(),
    sessionVersion: 1,
    tokenFamilyId: randomUUID(),
    employeeId: input.employeeId,
    organizationId: input.organizationId,
    restaurantId: input.restaurantId,
    branchIds: input.branchIds,
    permissions: ['reservations:approve'],
    permissionsVersion: 1,
  });
}

function customerToken(sub: string): string {
  return sign({
    sub,
    actorType: 'User',
    sessionId: randomUUID(),
    sessionVersion: 1,
    tokenFamilyId: randomUUID(),
  });
}

function connectSocket(token: string): Socket {
  return io(NGINX_BASE_URL, {
    path: '/socket.io/',
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    forceNew: true,
  });
}

function waitForConnect(socket: Socket, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function subscribe(
  socket: Socket,
  roomType: string,
  resourceId: string,
): Promise<{ ok: boolean; room?: string; code?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscribe ack timeout')), 8000);
    socket.emit('room.subscribe', { roomType, resourceId }, (ack: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(ack as never);
    });
  });
}

interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  data: Record<string, unknown>;
}

function waitForDomainEvent(
  socket: Socket,
  predicate: (e: DomainEventEnvelope) => boolean,
  timeoutMs = 10000,
): Promise<DomainEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('domain.event timeout')), timeoutMs);
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

async function main(): Promise<void> {
  console.log('[live-verify] seeding world in the live dev Postgres (localhost:5433)...');
  const org = await prisma.organization.create({
    data: { name: 'Phase8 Live Org', slug: `${PREFIX}org-${randomUUID()}`, billingEmail: `${PREFIX}${randomUUID()}@example.com` },
  });
  const restaurant = await prisma.restaurant.create({
    data: { organizationId: org.id, name: 'Phase8 Live Bistro', slug: `${PREFIX}${randomUUID()}`, status: 'Active' },
  });
  const branch = await prisma.branch.create({
    data: { restaurantId: restaurant.id, city: 'Damascus', address: '1 Live St', countryCode: 'SY', timezone: 'Asia/Damascus' },
  });
  const floorPlan = await prisma.floorPlan.create({
    data: { branchId: branch.id, name: 'Main Floor', isActive: true },
  });
  const table = await prisma.table.create({
    data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
  });
  const customer = await prisma.user.create({
    data: {
      firstName: 'Live',
      lastName: 'Customer',
      email: `${PREFIX}customer-${randomUUID()}@example.com`,
      passwordHash: 'argon2id$fake$not-used',
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  const employeeUser = await prisma.user.create({
    data: {
      firstName: 'Live',
      lastName: 'Employee',
      email: `${PREFIX}employee-${randomUUID()}@example.com`,
      passwordHash: 'argon2id$fake$not-used',
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  const otherBranchEmployeeUser = await prisma.user.create({
    data: {
      firstName: 'Outsider',
      lastName: 'Employee',
      email: `${PREFIX}outsider-${randomUUID()}@example.com`,
      passwordHash: 'argon2id$fake$not-used',
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  const otherBranch = await prisma.branch.create({
    data: { restaurantId: restaurant.id, city: 'Aleppo', address: '2 Live St', countryCode: 'SY', timezone: 'Asia/Damascus' },
  });
  const reservation = await prisma.reservation.create({
    data: {
      userId: customer.id,
      restaurantId: restaurant.id,
      branchId: branch.id,
      tableId: table.id,
      reservationDate: new Date('2026-12-20T00:00:00.000Z'),
      reservationStartTime: new Date('2026-12-20T18:00:00.000Z'),
      reservationEndTime: new Date('2026-12-20T19:30:00.000Z'),
      guests: 2,
      status: 'Pending',
      source: 'Online',
      createdBy: customer.id,
    },
  });
  console.log(`[live-verify] seeded reservation ${reservation.id} on branch ${branch.id}`);

  const empToken = employeeToken({
    sub: employeeUser.id,
    employeeId: randomUUID(),
    organizationId: org.id,
    restaurantId: restaurant.id,
    branchIds: [branch.id],
  });
  const custToken = customerToken(customer.id);
  const outsiderToken = employeeToken({
    sub: otherBranchEmployeeUser.id,
    employeeId: randomUUID(),
    organizationId: org.id,
    restaurantId: restaurant.id,
    branchIds: [otherBranch.id],
  });

  console.log('[live-verify] connecting 3 real socket.io-client sockets through Nginx (localhost:80/socket.io/)...');
  const staffSocket = connectSocket(empToken);
  const customerSocket = connectSocket(custToken);
  const outsiderSocket = connectSocket(outsiderToken);
  await Promise.all([waitForConnect(staffSocket), waitForConnect(customerSocket), waitForConnect(outsiderSocket)]);
  console.log('[live-verify] all 3 sockets connected and authenticated through Nginx.');

  const staffAck = await subscribe(staffSocket, 'branch', branch.id);
  console.log('[live-verify] staff subscribe ack:', staffAck);
  if (!staffAck.ok) throw new Error('staff subscribe failed');

  const customerAck = await subscribe(customerSocket, 'reservation', reservation.id);
  console.log('[live-verify] customer subscribe ack:', customerAck);
  if (!customerAck.ok) throw new Error('customer subscribe failed');

  const outsiderAck = await subscribe(outsiderSocket, 'branch', branch.id);
  console.log('[live-verify] outsider (wrong branch) subscribe ack (expect ok:false):', outsiderAck);
  if (outsiderAck.ok) throw new Error('outsider subscribe should have been denied');

  const staffEventPromise = waitForDomainEvent(staffSocket, (e) => e.eventType === 'ReservationApproved');
  const customerEventPromise = waitForDomainEvent(customerSocket, (e) => e.eventType === 'ReservationApproved');
  let outsiderReceived = false;
  outsiderSocket.on('domain.event', () => {
    outsiderReceived = true;
  });

  console.log('[live-verify] performing REAL REST mutation through Nginx: POST /api/v1/reservations/:id/approve');
  const approveResponse = await fetch(
    `${NGINX_BASE_URL}/api/v1/reservations/${reservation.id}/approve`,
    { method: 'POST', headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' }, body: '{}' },
  );
  console.log('[live-verify] approve REST response status:', approveResponse.status);
  if (approveResponse.status !== 200) {
    throw new Error(`approve REST call failed: ${approveResponse.status} ${await approveResponse.text()}`);
  }

  const [staffEvent, customerEvent] = await Promise.all([staffEventPromise, customerEventPromise]);
  console.log('[live-verify] staff received domain.event:', JSON.stringify(staffEvent, null, 2));
  console.log('[live-verify] customer received domain.event:', JSON.stringify(customerEvent, null, 2));

  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log('[live-verify] outsider received any domain.event (expect false):', outsiderReceived);
  if (outsiderReceived) throw new Error('outsider must not have received the event');

  const dbReservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
  console.log('[live-verify] independently verified DB state: status =', dbReservation.status, 'approvedBy =', dbReservation.approvedBy);
  if (dbReservation.status !== 'Approved') throw new Error('DB state was not actually Approved');

  const envelopeKeys = Object.keys(staffEvent).sort();
  const expectedKeys = ['aggregateId', 'aggregateType', 'correlationId', 'data', 'eventId', 'eventType', 'occurredAt'].sort();
  if (JSON.stringify(envelopeKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`envelope shape mismatch: got ${envelopeKeys.join(',')}`);
  }
  if ('approvedBy' in customerEvent.data) {
    throw new Error('customer payload leaked approvedBy (staff-only actor identifier)');
  }
  console.log('[live-verify] envelope shape verified; customer payload correctly PII/actor-minimized.');

  staffSocket.close();
  customerSocket.close();
  outsiderSocket.close();

  console.log('[live-verify] cleaning up scratch data...');
  await prisma.reservation.deleteMany({ where: { restaurant: { slug: { startsWith: PREFIX } } } });
  await prisma.table.deleteMany({ where: { branch: { restaurant: { slug: { startsWith: PREFIX } } } } });
  await prisma.floorPlan.deleteMany({ where: { branch: { restaurant: { slug: { startsWith: PREFIX } } } } });
  await prisma.branch.deleteMany({ where: { restaurant: { slug: { startsWith: PREFIX } } } });
  await prisma.restaurant.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.$disconnect();

  console.log('\n[live-verify] PHASE 8 LIVE NGINX VERIFICATION: PASSED\n');
}

main().catch(async (err) => {
  console.error('[live-verify] FAILED:', err);
  try {
    await prisma.reservation.deleteMany({ where: { restaurant: { slug: { startsWith: PREFIX } } } });
    await prisma.table.deleteMany({ where: { branch: { restaurant: { slug: { startsWith: PREFIX } } } } });
    await prisma.floorPlan.deleteMany({ where: { branch: { restaurant: { slug: { startsWith: PREFIX } } } } });
    await prisma.branch.deleteMany({ where: { restaurant: { slug: { startsWith: PREFIX } } } });
    await prisma.restaurant.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  } catch {
    // best-effort cleanup only
  }
  await prisma.$disconnect();
  process.exit(1);
});
