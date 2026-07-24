import { ReservationGuest as PrismaReservationGuestRow } from '@prisma/client';
import {
  ReservationGuest,
  ReservationGuestProps,
} from '../../domain/entities/reservation-guest.entity';

export type ReservationGuestRow = PrismaReservationGuestRow;

export class ReservationGuestPrismaMapper {
  static toDomain(row: ReservationGuestRow): ReservationGuest {
    const props: ReservationGuestProps = {
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      anonymizedAt: row.anonymizedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return ReservationGuest.reconstitute(props);
  }

  static toPersistence(guest: ReservationGuest): ReservationGuestRow {
    const props = guest.toProps();
    return {
      id: props.id,
      fullName: props.fullName,
      phone: props.phone,
      email: props.email,
      anonymizedAt: props.anonymizedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
