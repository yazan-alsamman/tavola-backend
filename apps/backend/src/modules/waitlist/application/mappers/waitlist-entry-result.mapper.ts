import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistEntryResult } from '../dto/waitlist-entry.result';

export function toWaitlistEntryResult(entry: ReservationWaitlistEntry): WaitlistEntryResult {
  return {
    entryId: entry.entryId,
    restaurantId: entry.restaurantId.value,
    branchId: entry.branchId.value,
    userId: entry.userId?.value ?? null,
    reservationGuestId: entry.reservationGuestId,
    partySize: entry.partySize,
    preferredDate: entry.preferredDate,
    preferredTimeFrom: entry.preferredTimeFrom,
    preferredTimeTo: entry.preferredTimeTo,
    status: entry.status,
    position: entry.position,
    convertedReservationId: entry.convertedReservationId,
    notifiedAt: entry.notifiedAt,
    expiresAt: entry.expiresAt,
    notes: entry.notes,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
