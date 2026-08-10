export interface ManuallyRecordCustomerAcquisitionCommand {
  restaurantId: string;
  userId: string | null;
  reservationGuestId: string | null;
  reason: string;
  actorId: string;
  correlationId?: string;
}
