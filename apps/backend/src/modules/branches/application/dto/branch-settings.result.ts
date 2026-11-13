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
  updatedAt: Date;
}
