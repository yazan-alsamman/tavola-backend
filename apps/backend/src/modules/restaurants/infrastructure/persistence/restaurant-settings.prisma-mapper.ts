import { RestaurantSettings as PrismaRestaurantSettings } from '@prisma/client';
import { RestaurantSettings as RestaurantSettingsEntity } from '../../domain/entities/restaurant-settings.entity';

export class RestaurantSettingsPrismaMapper {
  static toDomain(row: PrismaRestaurantSettings): RestaurantSettingsEntity {
    return RestaurantSettingsEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      reservationIntervalMinutes: row.reservationIntervalMinutes,
      maxGuestsPerReservation: row.maxGuestsPerReservation,
      cancellationWindowMinutes: row.cancellationWindowMinutes,
      pendingReservationTimeoutMinutes: row.pendingReservationTimeoutMinutes,
      defaultReservationDurationMinutes: row.defaultReservationDurationMinutes,
      autoApproval: row.autoApproval,
      timezone: row.timezone,
      defaultCurrency: row.defaultCurrency,
      reservationReminderMinutesBefore: row.reservationReminderMinutesBefore,
      lateArrivalGraceMinutes: row.lateArrivalGraceMinutes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(settings: RestaurantSettingsEntity): PrismaRestaurantSettings {
    const props = settings.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      reservationIntervalMinutes: props.reservationIntervalMinutes,
      maxGuestsPerReservation: props.maxGuestsPerReservation,
      cancellationWindowMinutes: props.cancellationWindowMinutes,
      pendingReservationTimeoutMinutes: props.pendingReservationTimeoutMinutes,
      defaultReservationDurationMinutes: props.defaultReservationDurationMinutes,
      autoApproval: props.autoApproval,
      timezone: props.timezone,
      defaultCurrency: props.defaultCurrency,
      reservationReminderMinutesBefore: props.reservationReminderMinutesBefore,
      lateArrivalGraceMinutes: props.lateArrivalGraceMinutes,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
