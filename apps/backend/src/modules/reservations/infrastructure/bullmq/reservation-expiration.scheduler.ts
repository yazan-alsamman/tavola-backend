import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ReservationExpirationSchedulerPort } from '@modules/reservations/application/ports/reservation-expiration-scheduler.port';
import {
  EXPIRE_RESERVATION_JOB_NAME,
  ExpireReservationJobData,
  RESERVATION_QUEUE_NAME,
} from './reservation-queue.constants';

/**
 * Phase 7.3 (Reservation Lifecycle) - the BullMQ-backed adapter for
 * `ReservationExpirationSchedulerPort`. `scheduleExpiration` always removes
 * any existing job for the same reservation first, so calling it again
 * (e.g. after a Pending reschedule shifts the window) replaces the prior
 * delay rather than leaving a stale duplicate - `queue.add` alone would not
 * update an existing delayed job's fire time for the same `jobId`.
 * `removeOnComplete`/`removeOnFail` keep the queue from accumulating
 * terminal job records indefinitely (TASKS.md's Phase 7 decision note item
 * 9's mechanism, not a new one).
 */
@Injectable()
export class BullMqReservationExpirationScheduler implements ReservationExpirationSchedulerPort {
  constructor(
    @InjectQueue(RESERVATION_QUEUE_NAME)
    private readonly queue: Queue<ExpireReservationJobData>,
  ) {}

  async scheduleExpiration(
    reservationId: string,
    organizationId: string | null,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void> {
    const jobId = this.jobId(reservationId);
    await this.queue.remove(jobId);
    const delay = Math.max(0, expireAt.getTime() - Date.now());
    await this.queue.add(
      EXPIRE_RESERVATION_JOB_NAME,
      { reservationId, organizationId, correlationId },
      { jobId, delay, removeOnComplete: true, removeOnFail: true },
    );
  }

  async cancelExpiration(reservationId: string): Promise<void> {
    await this.queue.remove(this.jobId(reservationId));
  }

  private jobId(reservationId: string): string {
    // BullMQ uses `:` internally as its Redis key delimiter and rejects any
    // custom job id containing one (`Job.validateOptions` throws "Custom Id
    // cannot contain :") - `-` keeps this globally unique per reservation
    // without colliding with that constraint.
    return `expire-reservation-${reservationId}`;
  }
}
