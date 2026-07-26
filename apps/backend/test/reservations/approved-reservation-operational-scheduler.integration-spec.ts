import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { BullMqApprovedReservationOperationalScheduler } from '@modules/reservations/infrastructure/bullmq/approved-reservation-operational.scheduler';
import {
  REMINDER_QUEUE_NAME,
  RESERVATION_REMINDER_JOB_NAME,
  ReservationReminderJobData,
} from '@modules/reservations/infrastructure/bullmq/reminder-queue.constants';
import {
  LATE_ARRIVAL_QUEUE_NAME,
  LATE_ARRIVAL_JOB_NAME,
  LateArrivalJobData,
} from '@modules/reservations/infrastructure/bullmq/late-arrival-queue.constants';
import {
  isRedisReachable,
  resolveTestRedisUrl,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';

/**
 * Phase 7.6 — proves ReminderQueue / LateArrivalQueue scheduling against real
 * Redis (BullMQ), not an in-memory fake: schedule, past-due clamp, replace
 * after Reschedule, and cancel on terminal transition.
 *
 * Passes connection options (not a shared ioredis instance) so BullMQ creates
 * its own clients — avoids the dual-ioredis-version typing clash that appears
 * when constructing Queue with an app-level Redis handle.
 */
describe('BullMqApprovedReservationOperationalScheduler (integration, real Redis)', () => {
  const queueDbIndex = Number(process.env.REDIS_QUEUE_DB_INDEX ?? '1');
  let redisAvailable = false;
  let reminderQueue: Queue<ReservationReminderJobData>;
  let lateArrivalQueue: Queue<LateArrivalJobData>;
  let scheduler: BullMqApprovedReservationOperationalScheduler;

  beforeAll(async () => {
    const redisUrl = resolveTestRedisUrl();
    redisAvailable = await isRedisReachable(redisUrl);
    if (skipUnlessDatabaseAvailable(redisAvailable)) {
      console.warn('Redis not reachable — skipping operational-scheduler integration tests.');
      return;
    }

    const parsed = new URL(redisUrl);
    const connection = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      password: parsed.password || undefined,
      db: queueDbIndex,
      maxRetriesPerRequest: null as null,
    };

    reminderQueue = new Queue(REMINDER_QUEUE_NAME, { connection });
    lateArrivalQueue = new Queue(LATE_ARRIVAL_QUEUE_NAME, { connection });
    scheduler = new BullMqApprovedReservationOperationalScheduler(
      reminderQueue as Queue<ReservationReminderJobData>,
      lateArrivalQueue as Queue<LateArrivalJobData>,
    );
  });

  afterAll(async () => {
    await reminderQueue?.close();
    await lateArrivalQueue?.close();
  });

  it('scheduleForApproved enqueues both delayed jobs with deterministic ids', async () => {
    if (!redisAvailable) return;

    const reservationId = randomUUID();
    const start = new Date(Date.now() + 2 * 60 * 60_000);

    await scheduler.scheduleForApproved(reservationId, randomUUID(), randomUUID(), start, 60, 15);

    const reminder = await reminderQueue.getJob(`reservation-reminder-${reservationId}`);
    const late = await lateArrivalQueue.getJob(`reservation-late-${reservationId}`);

    expect(reminder).toBeDefined();
    expect(late).toBeDefined();
    expect(reminder!.name).toBe(RESERVATION_REMINDER_JOB_NAME);
    expect(late!.name).toBe(LATE_ARRIVAL_JOB_NAME);
    expect(reminder!.data.reservationStartTime).toBe(start.toISOString());
    expect(late!.data.reservationStartTime).toBe(start.toISOString());

    const reminderState = await reminder!.getState();
    const lateState = await late!.getState();
    expect(['delayed', 'waiting']).toContain(reminderState);
    expect(['delayed', 'waiting']).toContain(lateState);

    await scheduler.cancelForReservation(reservationId);
  });

  it('past-due reminder window clamps to immediate fire (delay 0)', async () => {
    if (!redisAvailable) return;

    const reservationId = randomUUID();
    // Start is only 5 minutes ahead; reminder is 60 minutes before → already past due.
    const start = new Date(Date.now() + 5 * 60_000);

    await scheduler.scheduleForApproved(reservationId, randomUUID(), randomUUID(), start, 60, 15);

    const reminder = await reminderQueue.getJob(`reservation-reminder-${reservationId}`);
    expect(reminder).toBeDefined();
    expect(reminder!.opts.delay ?? 0).toBe(0);

    await scheduler.cancelForReservation(reservationId);
  });

  it('replaceForApproved removes the prior window and schedules against the new start time', async () => {
    if (!redisAvailable) return;

    const reservationId = randomUUID();
    const restaurantId = randomUUID();
    const branchId = randomUUID();
    const firstStart = new Date(Date.now() + 3 * 60 * 60_000);
    const secondStart = new Date(Date.now() + 5 * 60 * 60_000);

    await scheduler.scheduleForApproved(reservationId, restaurantId, branchId, firstStart, 60, 15);
    await scheduler.replaceForApproved(reservationId, restaurantId, branchId, secondStart, 60, 15);

    const reminder = await reminderQueue.getJob(`reservation-reminder-${reservationId}`);
    const late = await lateArrivalQueue.getJob(`reservation-late-${reservationId}`);
    expect(reminder!.data.reservationStartTime).toBe(secondStart.toISOString());
    expect(late!.data.reservationStartTime).toBe(secondStart.toISOString());

    await scheduler.cancelForReservation(reservationId);
  });

  it('cancelForReservation removes both Reminder and Late Arrival jobs', async () => {
    if (!redisAvailable) return;

    const reservationId = randomUUID();
    await scheduler.scheduleForApproved(
      reservationId,
      randomUUID(),
      randomUUID(),
      new Date(Date.now() + 4 * 60 * 60_000),
      60,
      15,
    );

    await scheduler.cancelForReservation(reservationId);

    expect(await reminderQueue.getJob(`reservation-reminder-${reservationId}`)).toBeUndefined();
    expect(await lateArrivalQueue.getJob(`reservation-late-${reservationId}`)).toBeUndefined();
  });
});
