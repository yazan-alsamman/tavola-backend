import { WaitlistEntryResult } from '../../application/dto/waitlist-entry.result';
import { WaitlistEntryResponseDto } from '../dto/waitlist-entry.response.dto';

function toTimeOfDayString(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const mm = String(value.getUTCMinutes()).padStart(2, '0');
  const ss = String(value.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function toWaitlistEntryResponse(result: WaitlistEntryResult): WaitlistEntryResponseDto {
  return {
    entryId: result.entryId,
    restaurantId: result.restaurantId,
    branchId: result.branchId,
    userId: result.userId,
    reservationGuestId: result.reservationGuestId,
    partySize: result.partySize,
    preferredDate: result.preferredDate.toISOString().slice(0, 10),
    preferredTimeFrom: toTimeOfDayString(result.preferredTimeFrom),
    preferredTimeTo: result.preferredTimeTo ? toTimeOfDayString(result.preferredTimeTo) : null,
    status: result.status,
    position: result.position,
    convertedReservationId: result.convertedReservationId,
    notifiedAt: result.notifiedAt ? result.notifiedAt.toISOString() : null,
    expiresAt: result.expiresAt.toISOString(),
    notes: result.notes,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
