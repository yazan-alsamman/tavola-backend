import { RestaurantSettings } from '../../domain/entities/restaurant-settings.entity';
import { RestaurantSettingsResult } from '../dto/restaurant-settings.result';

export function toRestaurantSettingsResult(settings: RestaurantSettings): RestaurantSettingsResult {
  return {
    restaurantId: settings.restaurantId.value,
    reservationIntervalMinutes: settings.reservationIntervalMinutes,
    maxGuestsPerReservation: settings.maxGuestsPerReservation,
    cancellationWindowMinutes: settings.cancellationWindowMinutes,
    pendingReservationTimeoutMinutes: settings.pendingReservationTimeoutMinutes,
    autoApproval: settings.autoApproval,
    timezone: settings.timezone,
    defaultCurrency: settings.defaultCurrency,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}
