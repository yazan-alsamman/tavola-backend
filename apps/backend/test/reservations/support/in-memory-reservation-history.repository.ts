import { ReservationHistory } from '@modules/reservations/domain/entities/reservation-history.entity';
import { ReservationHistoryRepository } from '@modules/reservations/domain/repositories/reservation-history.repository';

export class InMemoryReservationHistoryRepository implements ReservationHistoryRepository {
  public readonly rows: ReservationHistory[] = [];

  async save(history: ReservationHistory): Promise<void> {
    this.rows.push(history);
  }

  findByReservationId(reservationId: string): ReservationHistory[] {
    return this.rows.filter((row) => row.reservationId === reservationId);
  }
}
