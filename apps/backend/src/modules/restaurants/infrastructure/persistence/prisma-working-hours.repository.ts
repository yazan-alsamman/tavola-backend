import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { WorkingHours } from '../../domain/entities/working-hours.entity';
import { WorkingHoursRepository } from '../../domain/repositories/working-hours.repository';
import { WorkingHoursPrismaMapper } from './working-hours.prisma-mapper';

/**
 * `WorkingHours` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (no direct `organizationId` column), so queries here run through the
 * tenant-scoped `PrismaContext` client as a verified no-op passthrough -
 * exactly like `PrismaRestaurantSettingsRepository`. This repository
 * provides NO tenant isolation by itself. Every consuming use case MUST
 * resolve the parent `Restaurant` via `RestaurantRepository` (which IS
 * directly tenant-scoped) first, and only call these methods after that
 * succeeds - see `GetWorkingHoursUseCase`/`UpdateWorkingHoursUseCase`.
 */
@Injectable()
export class PrismaWorkingHoursRepository implements WorkingHoursRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<WorkingHours[]> {
    const rows = await this.prismaContext.client.workingHours.findMany({
      where: { restaurantId: restaurantId.value },
      orderBy: { dayOfWeek: 'asc' },
    });
    return rows.map((row) => WorkingHoursPrismaMapper.toDomain(row));
  }

  /**
   * Full-replace of the entire week for one restaurant: deletes every
   * existing row for `restaurantId` and inserts `entries` in a single
   * transaction, so a caller never observes a partially-replaced week.
   */
  async replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: WorkingHours[],
  ): Promise<void> {
    await this.prismaContext.runInTransaction(async () => {
      await this.prismaContext.client.workingHours.deleteMany({
        where: { restaurantId: restaurantId.value },
      });
      if (entries.length > 0) {
        await this.prismaContext.client.workingHours.createMany({
          data: entries.map((entry) => WorkingHoursPrismaMapper.toPersistence(entry)),
        });
      }
    });
  }
}
