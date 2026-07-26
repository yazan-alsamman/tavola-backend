import { ApprovedReservationOperationalSchedulerPort } from '@modules/reservations/application/ports/approved-reservation-operational-scheduler.port';

export interface ScheduledOperationalSignal {
  reservationId: string;
  restaurantId: string;
  branchId: string;
  reservationStartTime: Date;
  reminderMinutesBefore: number;
  lateArrivalGraceMinutes: number;
  correlationId?: string;
}

export class InMemoryApprovedReservationOperationalScheduler implements ApprovedReservationOperationalSchedulerPort {
  public readonly scheduled = new Map<string, ScheduledOperationalSignal>();
  public readonly cancelledReservationIds: string[] = [];
  public replaceCallCount = 0;
  public scheduleCallCount = 0;

  async scheduleForApproved(
    reservationId: string,
    restaurantId: string,
    branchId: string,
    reservationStartTime: Date,
    reminderMinutesBefore: number,
    lateArrivalGraceMinutes: number,
    correlationId?: string,
  ): Promise<void> {
    this.scheduleCallCount += 1;
    this.scheduled.set(reservationId, {
      reservationId,
      restaurantId,
      branchId,
      reservationStartTime,
      reminderMinutesBefore,
      lateArrivalGraceMinutes,
      correlationId,
    });
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
    this.replaceCallCount += 1;
    this.scheduled.set(reservationId, {
      reservationId,
      restaurantId,
      branchId,
      reservationStartTime,
      reminderMinutesBefore,
      lateArrivalGraceMinutes,
      correlationId,
    });
  }

  async cancelForReservation(reservationId: string): Promise<void> {
    this.cancelledReservationIds.push(reservationId);
    this.scheduled.delete(reservationId);
  }
}
