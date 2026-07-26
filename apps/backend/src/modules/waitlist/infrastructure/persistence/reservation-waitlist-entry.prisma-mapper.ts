import { ReservationWaitlistEntry as PrismaWaitlistEntryRow } from '@prisma/client';
import {
  ReservationWaitlistEntry,
  ReservationWaitlistEntryProps,
} from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';

export type WaitlistEntryRow = PrismaWaitlistEntryRow;

export class ReservationWaitlistEntryPrismaMapper {
  static toDomain(row: WaitlistEntryRow): ReservationWaitlistEntry {
    if (!Object.values(WaitlistStatus).includes(row.status as WaitlistStatus)) {
      throw new Error(`Unknown waitlist status persisted: ${row.status}`);
    }

    const props: ReservationWaitlistEntryProps = {
      id: row.id,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      userId: row.userId,
      reservationGuestId: row.reservationGuestId,
      partySize: row.partySize,
      preferredDate: row.preferredDate,
      preferredTimeFrom: row.preferredTimeFrom,
      preferredTimeTo: row.preferredTimeTo,
      status: row.status as WaitlistStatus,
      position: row.position,
      convertedReservationId: row.convertedReservationId,
      notifiedAt: row.notifiedAt,
      expiresAt: row.expiresAt,
      notes: row.notes,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };

    return ReservationWaitlistEntry.reconstitute(props);
  }

  static toPersistence(entry: ReservationWaitlistEntry): WaitlistEntryRow {
    const props = entry.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      userId: props.userId,
      reservationGuestId: props.reservationGuestId,
      partySize: props.partySize,
      preferredDate: props.preferredDate,
      preferredTimeFrom: props.preferredTimeFrom,
      preferredTimeTo: props.preferredTimeTo,
      status: props.status,
      position: props.position,
      convertedReservationId: props.convertedReservationId,
      notifiedAt: props.notifiedAt,
      expiresAt: props.expiresAt,
      notes: props.notes,
      createdBy: props.createdBy,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
