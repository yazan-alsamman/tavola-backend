import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSettings } from '../../domain/entities/restaurant-settings.entity';
import { RestaurantSettingsRepository } from '../../domain/repositories/restaurant-settings.repository';
import { RestaurantSettingsPrismaMapper } from './restaurant-settings.prisma-mapper';

/**
 * `RestaurantSettings` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so
 * queries here run through the tenant-scoped `PrismaContext` client as a
 * verified no-op passthrough - exactly like `PrismaEmployeeRepository`. This
 * repository provides NO tenant isolation by itself. Every consuming use
 * case MUST resolve the parent `Restaurant` via `RestaurantRepository`
 * (which IS directly tenant-scoped) first, and only call these methods
 * after that succeeds - see `GetRestaurantSettingsUseCase`/
 * `UpdateRestaurantSettingsUseCase`.
 */
@Injectable()
export class PrismaRestaurantSettingsRepository implements RestaurantSettingsRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantSettings | null> {
    const row = await this.prismaContext.client.restaurantSettings.findUnique({
      where: { restaurantId: restaurantId.value },
    });
    return row ? RestaurantSettingsPrismaMapper.toDomain(row) : null;
  }

  async save(settings: RestaurantSettings): Promise<void> {
    const data = RestaurantSettingsPrismaMapper.toPersistence(settings);
    await this.prismaContext.client.restaurantSettings.upsert({
      where: { id: data.id },
      create: data,
      update: {
        reservationIntervalMinutes: data.reservationIntervalMinutes,
        maxGuestsPerReservation: data.maxGuestsPerReservation,
        cancellationWindowMinutes: data.cancellationWindowMinutes,
        pendingReservationTimeoutMinutes: data.pendingReservationTimeoutMinutes,
        defaultReservationDurationMinutes: data.defaultReservationDurationMinutes,
        autoApproval: data.autoApproval,
        timezone: data.timezone,
        defaultCurrency: data.defaultCurrency,
        reservationReminderMinutesBefore: data.reservationReminderMinutesBefore,
        lateArrivalGraceMinutes: data.lateArrivalGraceMinutes,
        updatedAt: data.updatedAt,
      },
    });
  }
}
