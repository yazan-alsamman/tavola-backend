export interface RestaurantSettingsResult {
  restaurantId: string;
  reservationIntervalMinutes: number;
  maxGuestsPerReservation: number;
  cancellationWindowMinutes: number;
  pendingReservationTimeoutMinutes: number;
  autoApproval: boolean;
  timezone: string;
  defaultCurrency: string | null;
  createdAt: Date;
  updatedAt: Date;
}
