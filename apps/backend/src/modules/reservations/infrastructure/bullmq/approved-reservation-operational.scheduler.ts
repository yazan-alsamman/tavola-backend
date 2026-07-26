import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApprovedReservationOperationalSchedulerPort } from '@modules/reservations/application/ports/approved-reservation-operational-scheduler.port';
import {
  REMINDER_QUEUE_NAME,
  RESERVATION_REMINDER_JOB_NAME,
  ReservationReminderJobData,
} from './reminder-queue.constants';
import {
  LATE_ARRIVAL_QUEUE_NAME,
  LATE_ARRIVAL_JOB_NAME,
  LateArrivalJobData,
} from './late-arrival-queue.constants';

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the BullMQ-backed adapter for
 * `ApprovedReservationOperationalSchedulerPort`. Both
 * `scheduleForApproved`/`replaceForApproved` resolve to the same
 * remove-then-add mechanism (`BullMqReservationExpirationScheduler`'s own
 * precedent: `queue.add` alone does not update an existing delayed job's
 * fire time for the same `jobId`), so a first-time Approval and a later
 * Reschedule-of-Approved behave identically at this layer - the distinct
 * method names exist for call-site clarity only (see the port's own doc
 * comment).
 */
@Injectable()
export class BullMqApprovedReservationOperationalScheduler implements ApprovedReservationOperationalSchedulerPort {
  constructor(
    @InjectQueue(REMINDER_QUEUE_NAME)
    private readonly reminderQueue: Queue<ReservationReminderJobData>,
    @InjectQueue(LATE_ARRIVAL_QUEUE_NAME)
    private readonly lateArrivalQueue: Queue<LateArrivalJobData>,
  ) {}

  async scheduleForApproved(
    reservationId: string,
    restaurantId: string,
    branchId: string,
    reservationStartTime: Date,
    reminderMinutesBefore: number,
    lateArrivalGraceMinutes: number,
    correlationId?: string,
  ): Promise<void> {
    await this.scheduleBoth(
      reservationId,
      restaurantId,
      branchId,
      reservationStartTime,
      reminderMinutesBefore,
      lateArrivalGraceMinutes,
      correlationId,
    );
  }

  async replaceForApproved(
    reservationId: string,
    restaurantId: string,
    branchId: string,
    reservationStartTime: Date,
    reminderMinutesBefore: number,
    lateArrivalGraceMinutes: number,
    correlationId?: string,
  ): Promise<void> {
    await this.scheduleBoth(
      reservationId,
      restaurantId,
      branchId,
      reservationStartTime,
      reminderMinutesBefore,
      lateArrivalGraceMinutes,
      correlationId,
    );
  }

  async cancelForReservation(reservationId: string): Promise<void> {
    await this.reminderQueue.remove(this.reminderJobId(reservationId));
    await this.lateArrivalQueue.remove(this.lateArrivalJobId(reservationId));
  }

  private async scheduleBoth(
    reservationId: string,
    restaurantId: string,
    branchId: string,
    reservationStartTime: Date,
    reminderMinutesBefore: number,
    lateArrivalGraceMinutes: number,
    correlationId?: string,
  ): Promise<void> {
    const reminderJobId = this.reminderJobId(reservationId);
    const lateArrivalJobId = this.lateArrivalJobId(reservationId);
    await this.reminderQueue.remove(reminderJobId);
    await this.lateArrivalQueue.remove(lateArrivalJobId);

    const reminderAt = new Date(reservationStartTime.getTime() - reminderMinutesBefore * 60_000);
    const lateArrivalAt = new Date(
      reservationStartTime.getTime() + lateArrivalGraceMinutes * 60_000,
    );
    // Clamp to 0 for a job whose due time already lies in the past (e.g. a
    // reminder window shorter than the time already elapsed since booking) -
    // BullMQ fires it immediately rather than rejecting a negative delay.
    const reminderDelay = Math.max(0, reminderAt.getTime() - Date.now());
    const lateArrivalDelay = Math.max(0, lateArrivalAt.getTime() - Date.now());

    const reservationStartTimeIso = reservationStartTime.toISOString();

    await this.reminderQueue.add(
      RESERVATION_REMINDER_JOB_NAME,
      {
        reservationId,
        restaurantId,
        branchId,
        organizationId: null,
        reservationStartTime: reservationStartTimeIso,
        correlationId,
      },
      { jobId: reminderJobId, delay: reminderDelay, removeOnComplete: true, removeOnFail: true },
    );

    await this.lateArrivalQueue.add(
      LATE_ARRIVAL_JOB_NAME,
      {
        reservationId,
        restaurantId,
        branchId,
        organizationId: null,
        reservationStartTime: reservationStartTimeIso,
        correlationId,
      },
      {
        jobId: lateArrivalJobId,
        delay: lateArrivalDelay,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  private reminderJobId(reservationId: string): string {
    // BullMQ rejects a custom job id containing `:` - `-` throughout, same
    // as every other job id in this codebase (see
    // BullMqReservationExpirationScheduler's own doc comment).
    return `reservation-reminder-${reservationId}`;
  }

  private lateArrivalJobId(reservationId: string): string {
    return `reservation-late-${reservationId}`;
  }
}
