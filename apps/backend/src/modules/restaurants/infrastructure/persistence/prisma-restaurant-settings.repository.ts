import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
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

  async findForBranch(
    restaurantId: RestaurantId,
    branchId: BranchId,
  ): Promise<RestaurantSettings | null> {
    const [restaurantRow, branchRow] = await Promise.all([
      this.prismaContext.client.restaurantSettings.findUnique({
        where: { restaurantId: restaurantId.value },
      }),
      this.prismaContext.client.branchSettings.findUnique({
        where: { branchId: branchId.value },
      }),
    ]);
    if (branchRow === null) {
      return restaurantRow ? RestaurantSettingsPrismaMapper.toDomain(restaurantRow) : null;
    }
    return RestaurantSettings.reconstitute({
      id: branchRow.id,
      restaurantId: restaurantId.value,
      reservationIntervalMinutes: branchRow.reservationIntervalMinutes,
      maxGuestsPerReservation: branchRow.maxGuestsPerReservation,
      cancellationWindowMinutes: branchRow.cancellationWindowMinutes,
      pendingReservationTimeoutMinutes: branchRow.pendingReservationTimeoutMinutes,
      defaultReservationDurationMinutes: branchRow.defaultReservationDurationMinutes,
      autoApproval: branchRow.autoApproval,
      timezone: restaurantRow?.timezone ?? 'UTC',
      defaultCurrency: restaurantRow?.defaultCurrency ?? null,
      reservationReminderMinutesBefore: branchRow.reservationReminderMinutesBefore,
      lateArrivalGraceMinutes: branchRow.lateArrivalGraceMinutes,
      createdAt: branchRow.createdAt,
      updatedAt: branchRow.updatedAt,
    });
  }

  async saveForBranch(branchId: BranchId, settings: RestaurantSettings): Promise<void> {
    const rules = {
      reservationIntervalMinutes: settings.reservationIntervalMinutes,
      maxGuestsPerReservation: settings.maxGuestsPerReservation,
      cancellationWindowMinutes: settings.cancellationWindowMinutes,
      pendingReservationTimeoutMinutes: settings.pendingReservationTimeoutMinutes,
      defaultReservationDurationMinutes: settings.defaultReservationDurationMinutes,
      autoApproval: settings.autoApproval,
      reservationReminderMinutesBefore: settings.reservationReminderMinutesBefore,
      lateArrivalGraceMinutes: settings.lateArrivalGraceMinutes,
      updatedAt: settings.updatedAt,
    };
    await this.prismaContext.client.branchSettings.upsert({
      where: { branchId: branchId.value },
      create: { branchId: branchId.value, ...rules },
      update: rules,
    });
  }
}
