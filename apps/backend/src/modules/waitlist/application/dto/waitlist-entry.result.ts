import { WaitlistStatus } from '../../domain/enums/waitlist.enums';

export interface WaitlistEntryResult {
  entryId: string;
  restaurantId: string;
  branchId: string;
  userId: string | null;
  reservationGuestId: string | null;
  partySize: number;
  preferredDate: Date;
  preferredTimeFrom: Date;
  preferredTimeTo: Date | null;
  status: WaitlistStatus;
  position: number;
  convertedReservationId: string | null;
  notifiedAt: Date | null;
  expiresAt: Date;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
