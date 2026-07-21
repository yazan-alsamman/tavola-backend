export interface SearchAvailabilityCommand {
  branchId: string;
  reservationStartTime: string;
  reservationEndTime?: string;
  partySize: number;
}
