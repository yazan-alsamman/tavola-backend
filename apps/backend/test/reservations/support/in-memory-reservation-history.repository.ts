import { ReservationHistory } from '@modules/reservations/domain/entities/reservation-history.entity';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationHistoryRepository } from '@modules/reservations/domain/repositories/reservation-history.repository';

export class InMemoryReservationHistoryRepository implements ReservationHistoryRepository {
  public readonly rows: ReservationHistory[] = [];

  async save(history: ReservationHistory): Promise<void> {
    this.rows.push(history);
  }

  async wasCompletedBySystem(reservationId: string): Promise<boolean> {
    return this.rows.some(
      (row) =>
        row.reservationId === reservationId &&
        row.newStatus === ReservationStatus.Completed &&
        row.changedBy === null,
    );
  }

  findByReservationId(reservationId: string): ReservationHistory[] {
    return this.rows.filter((row) => row.reservationId === reservationId);
  }
}
