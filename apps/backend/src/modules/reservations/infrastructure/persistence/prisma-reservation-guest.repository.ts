import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationGuest } from '../../domain/entities/reservation-guest.entity';
import { ReservationGuestRepository } from '../../domain/repositories/reservation-guest.repository';
import { ReservationGuestPrismaMapper } from './reservation-guest.prisma-mapper';

/**
 * `ReservationGuest` is not in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (same reasoning as `Reservation`/
 * `ReservationHistory` themselves) - the ordinary tenant-scoped
 * `PrismaContext` client is a safe no-op passthrough.
 */
@Injectable()
export class PrismaReservationGuestRepository implements ReservationGuestRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async save(guest: ReservationGuest): Promise<void> {
    const data = ReservationGuestPrismaMapper.toPersistence(guest);
    await this.prismaContext.client.reservationGuest.create({ data });
  }
}
