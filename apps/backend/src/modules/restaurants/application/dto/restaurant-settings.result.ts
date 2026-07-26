export interface RestaurantSettingsResult {
  restaurantId: string;
  reservationIntervalMinutes: number;
  maxGuestsPerReservation: number;
  cancellationWindowMinutes: number;
  pendingReservationTimeoutMinutes: number;
  defaultReservationDurationMinutes: number;
  autoApproval: boolean;
  timezone: string;
  defaultCurrency: string | null;
  reservationReminderMinutesBefore: number;
  lateArrivalGraceMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}
