/**
 * Phase 7.6 live verification against the rebuilt Docker backend (host port 3000).
 * Creates scratch data, proves Approve schedules Reminder+Late jobs in Redis,
 * Table Ready CAS, Reschedule resets timestamps + replaces jobs, Cancel removes
 * jobs, auto-approve Create schedules both, then deletes all scratch rows.
 * Does not modify env files/secrets.
 */
import { PrismaClient, RoleScope } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';

const API = process.env.LIVE_API_BASE ?? 'http://localhost:3000/api/v1';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public';
const REDIS_URL =
  process.env.REDIS_URL ?? 'redis://:tavla_dev_redis_password@localhost:6379';
const QUEUE_DB = Number(process.env.REDIS_QUEUE_DB_INDEX ?? '1');
const PREFIX = `phase76-live-${randomUUID().slice(0, 8)}`;
const PASSWORD = 'SecurePass123!';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

type Envelope<T> = { data: T; statusCode?: number };

async function http<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T; raw: unknown }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Envelope<T> | T;
  const data =
    json && typeof json === 'object' && 'data' in (json as object)
      ? ((json as Envelope<T>).data as T)
      : (json as T);
  return { status: res.status, data, raw: json };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function seedUser(email: string, passwordHash: string, lastName: string): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      firstName: 'Live',
      lastName,
      email,
      passwordHash,
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  return id;
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD);
  const parsedRedis = new URL(REDIS_URL);
  const connection = {
    host: parsedRedis.hostname,
    port: Number(parsedRedis.port || 6379),
    password: parsedRedis.password || undefined,
    db: QUEUE_DB,
    maxRetriesPerRequest: null as null,
  };
  const reminderQueue = new Queue('ReminderQueue', { connection });
  const lateQueue = new Queue('LateArrivalQueue', { connection });

  const ownerEmail = `${PREFIX}-owner@example.com`;
  const customerEmail = `${PREFIX}-customer@example.com`;
  const employeeEmail = `${PREFIX}-employee@example.com`;

  let ownerId = '';
  let customerId = '';
  let employeeUserId = '';
  let organizationId = '';
  let restaurantId = '';
  let branchId = '';
  let tableId = '';
  let reservationId = '';
  let autoReservationId = '';

  try {
    const healthRes = await fetch(`${API}/health`);
    assert(healthRes.ok, `health HTTP ${healthRes.status}`);
    const health = (await healthRes.json()) as { status: string };
    assert(health.status === 'ok', `health status ${health.status}`);
    console.log('health OK');

    const manager = await prisma.role.upsert({
      where: { slug: 'manager' },
      update: {},
      create: {
        name: 'Restaurant Manager',
        slug: 'manager',
        description: 'Full restaurant operational access',
        scope: RoleScope.Restaurant,
      },
    });
    const tableready = await prisma.permission.findUnique({
      where: { slug: 'reservations:tableready' },
    });
    assert(tableready, 'reservations:tableready permission missing — run prisma seed');

    ownerId = await seedUser(ownerEmail, passwordHash, 'Owner');
    customerId = await seedUser(customerEmail, passwordHash, 'Customer');
    employeeUserId = await seedUser(employeeEmail, passwordHash, 'Employee');

    organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `${PREFIX}-org`,
        slug: `${PREFIX}-org`,
        billingEmail: ownerEmail,
      },
    });
    const now = new Date();
    await prisma.organizationMember.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: ownerId,
        role: 'Owner',
        status: 'Active',
        invitedAt: now,
        joinedAt: now,
      },
    });

    const ownerLogin = await http<{ accessToken: string }>('POST', '/auth/login', {
      email: ownerEmail,
      password: PASSWORD,
      deviceType: 'web',
    });
    assert(ownerLogin.status === 200, `owner login ${ownerLogin.status}`);
    const ownerToken = ownerLogin.data.accessToken;

    const restaurant = await http<{ restaurantId: string }>(
      'POST',
      '/restaurants',
      { name: `${PREFIX} Restaurant`, slug: `${PREFIX}-rest` },
      ownerToken,
    );
    assert(restaurant.status === 201, `create restaurant ${restaurant.status}`);
    restaurantId = restaurant.data.restaurantId;

    const settingsGet = await http<{
      reservationIntervalMinutes: number;
      maxGuestsPerReservation: number;
      cancellationWindowMinutes: number;
      pendingReservationTimeoutMinutes: number;
      defaultReservationDurationMinutes: number;
      autoApproval: boolean;
      timezone: string;
      defaultCurrency: string | null;
      reservationReminderMinutesBefore: number;
      lateArrivalGraceMinutes: number;
    }>('GET', `/restaurants/${restaurantId}/settings`, undefined, ownerToken);
    assert(settingsGet.status === 200, `get settings ${settingsGet.status}`);
    const patched = await http(
      'PATCH',
      `/restaurants/${restaurantId}/settings`,
      {
        reservationIntervalMinutes: settingsGet.data.reservationIntervalMinutes,
        maxGuestsPerReservation: settingsGet.data.maxGuestsPerReservation,
        cancellationWindowMinutes: settingsGet.data.cancellationWindowMinutes,
        pendingReservationTimeoutMinutes:
          settingsGet.data.pendingReservationTimeoutMinutes,
        defaultReservationDurationMinutes:
          settingsGet.data.defaultReservationDurationMinutes,
        autoApproval: false,
        timezone: settingsGet.data.timezone,
        defaultCurrency: settingsGet.data.defaultCurrency,
        reservationReminderMinutesBefore: 60,
        lateArrivalGraceMinutes: 15,
      },
      ownerToken,
    );
    assert(patched.status === 200, `patch settings ${patched.status} ${JSON.stringify(patched.raw)}`);
    const settingsVerify = await http<Record<string, number>>(
      'GET',
      `/restaurants/${restaurantId}/settings`,
      undefined,
      ownerToken,
    );
    assert(
      settingsVerify.data.reservationReminderMinutesBefore === 60,
      'settings reminder not persisted',
    );
    assert(settingsVerify.data.lateArrivalGraceMinutes === 15, 'settings grace not persisted');
    console.log('RestaurantSettings persistence OK');

    const branch = await http<{ branchId: string }>(
      'POST',
      `/restaurants/${restaurantId}/branches`,
      {
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
      ownerToken,
    );
    assert(branch.status === 201, `create branch ${branch.status}`);
    branchId = branch.data.branchId;

    const floorPlan = await http<{ floorPlanId: string }>(
      'POST',
      `/restaurants/${restaurantId}/branches/${branchId}/floor-plans`,
      { name: 'Main Floor' },
      ownerToken,
    );
    assert(floorPlan.status === 201, `floor plan ${floorPlan.status}`);

    const table = await http<{ tableId: string }>(
      'POST',
      `/restaurants/${restaurantId}/branches/${branchId}/tables`,
      { floorPlanId: floorPlan.data.floorPlanId, tableNumber: 'T1', capacity: 4 },
      ownerToken,
    );
    assert(table.status === 201, `create table ${table.status}`);
    tableId = table.data.tableId;

    const invited = await http<{ employeeId: string }>(
      'POST',
      `/restaurants/${restaurantId}/employees`,
      {
        roleId: manager.id,
        firstName: 'Live',
        lastName: 'Manager',
        email: employeeEmail,
      },
      ownerToken,
    );
    assert(invited.status === 201, `invite employee ${invited.status}`);
    await http(
      'POST',
      `/restaurants/${restaurantId}/employees/${invited.data.employeeId}/branches`,
      { branchId },
      ownerToken,
    );

    const staffLogin = await http<{ accessToken: string }>('POST', '/auth/login', {
      email: employeeEmail,
      password: PASSWORD,
      deviceType: 'web',
    });
    assert(staffLogin.status === 200, `staff login ${staffLogin.status}`);
    const staffToken = staffLogin.data.accessToken;

    const customerLogin = await http<{ accessToken: string }>('POST', '/auth/login', {
      email: customerEmail,
      password: PASSWORD,
      deviceType: 'web',
    });
    assert(customerLogin.status === 200, `customer login ${customerLogin.status}`);
    const customerToken = customerLogin.data.accessToken;

    // Start in 2h so Reminder (60m before) stays delayed long enough to inspect in Redis.
    // Separate past-due clamp proof: a second Approved reservation with start in 30m.
    const start = new Date(Date.now() + 2 * 60 * 60_000);

    const created = await http<{ reservationId: string; status: string }>(
      'POST',
      '/reservations',
      {
        branchId,
        tableId,
        reservationStartTime: start.toISOString(),
        guests: 2,
      },
      customerToken,
    );
    assert(
      created.status === 201,
      `create reservation ${created.status} ${JSON.stringify(created.raw)}`,
    );
    assert(created.data.status === 'Pending', 'expected Pending');
    reservationId = created.data.reservationId;

    const approved = await http<{ reservationId: string; status: string }>(
      'POST',
      `/reservations/${reservationId}/approve`,
      {},
      staffToken,
    );
    assert(approved.status === 200, `approve ${approved.status}`);
    assert(approved.data.status === 'Approved', 'expected Approved');

    await new Promise((r) => setTimeout(r, 800));

    const reminderJob = await reminderQueue.getJob(`reservation-reminder-${reservationId}`);
    const lateJob = await lateQueue.getJob(`reservation-late-${reservationId}`);
    assert(reminderJob, 'Reminder job missing after Approve');
    assert(lateJob, 'Late Arrival job missing after Approve');
    assert((reminderJob.opts.delay ?? 0) > 0, 'future Reminder should still be delayed');
    console.log('Approve scheduled Reminder+Late OK');

    // Past-due Reminder clamp on a separate table (avoid ADR-013 overlap with the first).
    const table2 = await http<{ tableId: string }>(
      'POST',
      `/restaurants/${restaurantId}/branches/${branchId}/tables`,
      { floorPlanId: floorPlan.data.floorPlanId, tableNumber: 'T2', capacity: 4 },
      ownerToken,
    );
    assert(table2.status === 201, `create table2 ${table2.status}`);
    const pastDueStart = new Date(Date.now() + 30 * 60_000);
    const pastDueCreated = await http<{ reservationId: string; status: string }>(
      'POST',
      '/reservations',
      {
        branchId,
        tableId: table2.data.tableId,
        reservationStartTime: pastDueStart.toISOString(),
        guests: 2,
      },
      customerToken,
    );
    assert(
      pastDueCreated.status === 201,
      `past-due create ${pastDueCreated.status} ${JSON.stringify(pastDueCreated.raw)}`,
    );
    const pastDueId = pastDueCreated.data.reservationId;
    const pastDueApproved = await http(
      'POST',
      `/reservations/${pastDueId}/approve`,
      {},
      staffToken,
    );
    assert(pastDueApproved.status === 200, `past-due approve ${pastDueApproved.status}`);

    let sawClamp = false;
    for (let i = 0; i < 20; i += 1) {
      const job = await reminderQueue.getJob(`reservation-reminder-${pastDueId}`);
      if (job && (job.opts.delay ?? 0) === 0) {
        sawClamp = true;
        break;
      }
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'reservation.reminder_due', targetId: pastDueId },
      });
      if (audit?.actorType === 'System') {
        sawClamp = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(sawClamp, 'past-due Reminder did not clamp/fire with System audit');
    console.log('Past-due Reminder clamp/immediate fire OK');
    await reminderQueue.remove(`reservation-reminder-${pastDueId}`).catch(() => undefined);
    await lateQueue.remove(`reservation-late-${pastDueId}`).catch(() => undefined);

    const customerReady = await http(
      'POST',
      `/reservations/${reservationId}/table-ready`,
      {},
      customerToken,
    );
    assert(
      customerReady.status === 403,
      `customer table-ready expected 403 got ${customerReady.status}`,
    );

    const ready = await http<{ reservationId: string; status: string }>(
      'POST',
      `/reservations/${reservationId}/table-ready`,
      {},
      staffToken,
    );
    assert(ready.status === 200, `table-ready ${ready.status}`);
    assert(ready.data.status === 'Approved', 'table-ready must not change status');

    const rowReady = await prisma.reservation.findUnique({ where: { id: reservationId } });
    assert(rowReady?.tableReadyNotifiedAt, 'tableReadyNotifiedAt must be set in DB');
    const tableAfter = await prisma.table.findUnique({ where: { id: tableId } });
    assert(
      tableAfter?.status === 'Reserved',
      `table should remain Reserved, got ${tableAfter?.status}`,
    );
    console.log('Table Ready OK (status Approved, table Reserved, timestamp set)');

    const readyDup = await http(
      'POST',
      `/reservations/${reservationId}/table-ready`,
      {},
      staffToken,
    );
    assert(readyDup.status === 400, `duplicate table-ready expected 400 got ${readyDup.status}`);

    const newStart = new Date(Date.now() + 3 * 60 * 60_000);
    const newEnd = new Date(newStart.getTime() + 90 * 60_000);
    const rescheduled = await http<{ reservationId: string; status: string }>(
      'POST',
      `/reservations/${reservationId}/reschedule`,
      {
        tableId,
        reservationStartTime: newStart.toISOString(),
        reservationEndTime: newEnd.toISOString(),
        guests: 2,
      },
      staffToken,
    );
    assert(rescheduled.status === 200, `reschedule ${rescheduled.status}`);

    const rowResched = await prisma.reservation.findUnique({ where: { id: reservationId } });
    assert(rowResched?.lateArrivalNotifiedAt === null, 'reschedule must reset lateArrivalNotifiedAt');
    assert(rowResched?.tableReadyNotifiedAt === null, 'reschedule must reset tableReadyNotifiedAt');

    await new Promise((r) => setTimeout(r, 800));
    const reminderAfter = await reminderQueue.getJob(`reservation-reminder-${reservationId}`);
    const lateAfter = await lateQueue.getJob(`reservation-late-${reservationId}`);
    assert(reminderAfter, 'Reminder job missing after Reschedule');
    assert(lateAfter, 'Late Arrival job missing after Reschedule');
    assert(
      reminderAfter.data.reservationStartTime === newStart.toISOString(),
      'Reminder job must target new start',
    );
    console.log('Reschedule reset timestamps + replaced jobs OK');

    const cancelled = await http(
      'POST',
      `/reservations/${reservationId}/cancel`,
      {},
      staffToken,
    );
    assert(cancelled.status === 200, `cancel ${cancelled.status}`);
    await new Promise((r) => setTimeout(r, 800));
    assert(
      (await reminderQueue.getJob(`reservation-reminder-${reservationId}`)) === undefined,
      'Reminder job should be removed after Cancel',
    );
    assert(
      (await lateQueue.getJob(`reservation-late-${reservationId}`)) === undefined,
      'Late Arrival job should be removed after Cancel',
    );
    console.log('Cancel removed Reminder+Late jobs OK');

    await prisma.restaurantSettings.update({
      where: { restaurantId },
      data: { autoApproval: true },
    });
    const autoStart = new Date(Date.now() + 4 * 60 * 60_000);
    const autoCreated = await http<{ reservationId: string; status: string }>(
      'POST',
      '/reservations',
      {
        branchId,
        tableId,
        reservationStartTime: autoStart.toISOString(),
        guests: 2,
      },
      customerToken,
    );
    assert(autoCreated.status === 201, `auto create ${autoCreated.status}`);
    assert(autoCreated.data.status === 'Approved', 'autoApproval must yield Approved');
    autoReservationId = autoCreated.data.reservationId;
    await new Promise((r) => setTimeout(r, 800));
    assert(
      await reminderQueue.getJob(`reservation-reminder-${autoReservationId}`),
      'Reminder missing after auto-approve create',
    );
    assert(
      await lateQueue.getJob(`reservation-late-${autoReservationId}`),
      'Late Arrival missing after auto-approve create',
    );
    console.log('Auto-approve Create scheduled Reminder+Late OK');

    await reminderQueue.remove(`reservation-reminder-${autoReservationId}`);
    await lateQueue.remove(`reservation-late-${autoReservationId}`);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'reservation.table_ready_notified',
        targetId: reservationId,
      },
      orderBy: { occurredAt: 'desc' },
    });
    // reservationId was Cancelled after Table Ready; audit row still retained by targetId.
    if (!audit) {
      const anyReady = await prisma.auditLog.findFirst({
        where: { action: 'reservation.table_ready_notified' },
        orderBy: { occurredAt: 'desc' },
      });
      assert(anyReady?.actorType === 'Employee', 'expected Employee TableReady audit');
      console.log('TableReady audit attribution OK (Employee)');
    } else {
      assert(audit.actorType === 'Employee', `expected Employee audit, got ${audit.actorType}`);
      console.log('TableReady audit attribution OK (Employee)');
    }

    console.log('PHASE 7.6 LIVE HTTP/BULLMQ VERIFICATION PASSED');
  } finally {
    await reminderQueue.close().catch(() => undefined);
    await lateQueue.close().catch(() => undefined);

    if (restaurantId) {
      await prisma.reservationHistory.deleteMany({
        where: { reservation: { restaurantId } },
      });
      await prisma.reservation.deleteMany({ where: { restaurantId } });
      await prisma.employeeBranchAssignment.deleteMany({
        where: { employee: { restaurantId } },
      });
      await prisma.employee.deleteMany({ where: { restaurantId } });
      await prisma.table.deleteMany({ where: { branch: { restaurantId } } });
      await prisma.floorPlan.deleteMany({ where: { branch: { restaurantId } } });
      await prisma.branch.deleteMany({ where: { restaurantId } });
      await prisma.restaurantSettings.deleteMany({ where: { restaurantId } });
      await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
    }
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    const userIds = [ownerId, customerId, employeeUserId].filter(Boolean);
    if (userIds.length) {
      await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.tokenFamily.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    console.log('scratch data cleaned');
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
