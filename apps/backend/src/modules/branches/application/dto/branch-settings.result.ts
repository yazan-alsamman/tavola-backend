/** ADR-051: the reservation rules a branch uses. */
export interface BranchSettingsResult {
  branchId: string;
  reservationIntervalMinutes: number;
  maxGuestsPerReservation: number;
  cancellationWindowMinutes: number;
  pendingReservationTimeoutMinutes: number;
  defaultReservationDurationMinutes: number;
  autoApproval: boolean;
  reservationReminderMinutesBefore: number;
  lateArrivalGraceMinutes: number;
  /** ADR-053 */
  autoApprovalMaxGuests: number | null;
  minLeadTimeMinutes: number;
  maxDaysAhead: number | null;
  dailyGuestCap: number | null;
  updatedAt: Date;
}
