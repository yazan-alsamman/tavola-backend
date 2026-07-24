import { ReservationGuest } from '@modules/reservations/domain/entities/reservation-guest.entity';
import { ReservationGuestRepository } from '@modules/reservations/domain/repositories/reservation-guest.repository';

export class InMemoryReservationGuestRepository implements ReservationGuestRepository {
  private readonly rows = new Map<string, ReservationGuest>();

  async save(guest: ReservationGuest): Promise<void> {
    this.rows.set(guest.guestId, guest);
  }

  findById(id: string): ReservationGuest | null {
    return this.rows.get(id) ?? null;
  }

  get size(): number {
    return this.rows.size;
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: ReservationGuestRepository = new InMemoryReservationGuestRepository();
void _typeCheck;
