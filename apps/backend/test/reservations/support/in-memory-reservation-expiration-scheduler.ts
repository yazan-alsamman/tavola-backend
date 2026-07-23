import { ReservationExpirationSchedulerPort } from '@modules/reservations/application/ports/reservation-expiration-scheduler.port';

export class InMemoryReservationExpirationScheduler implements ReservationExpirationSchedulerPort {
  public readonly scheduled = new Map<
    string,
    { organizationId: string | null; expireAt: Date; correlationId?: string }
  >();
  public readonly cancelledReservationIds: string[] = [];

  async scheduleExpiration(
    reservationId: string,
    organizationId: string | null,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void> {
    this.scheduled.set(reservationId, { organizationId, expireAt, correlationId });
  }

  async cancelExpiration(reservationId: string): Promise<void> {
    this.cancelledReservationIds.push(reservationId);
    this.scheduled.delete(reservationId);
  }
}
