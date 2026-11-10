import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationHistory } from '../../domain/entities/reservation-history.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationHistoryRepository } from '../../domain/repositories/reservation-history.repository';
import { ReservationHistoryPrismaMapper } from './reservation-history.prisma-mapper';

/**
 * `ReservationHistory` is not in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (same reasoning as `Reservation` itself) - the
 * ordinary tenant-scoped `PrismaContext` client is a safe no-op passthrough.
 */
@Injectable()
export class PrismaReservationHistoryRepository implements ReservationHistoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async save(history: ReservationHistory): Promise<void> {
    const data = ReservationHistoryPrismaMapper.toPersistence(history);
    await this.prismaContext.client.reservationHistory.create({ data });
  }

  async wasCompletedBySystem(reservationId: string): Promise<boolean> {
    const row = await this.prismaContext.client.reservationHistory.findFirst({
      where: { reservationId, newStatus: ReservationStatus.Completed, changedBy: null },
      select: { id: true },
    });
    return row !== null;
  }
}
