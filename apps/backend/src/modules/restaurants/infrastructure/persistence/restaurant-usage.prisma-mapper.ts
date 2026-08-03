import { RestaurantUsage as PrismaRestaurantUsage } from '@prisma/client';
import { RestaurantUsage as RestaurantUsageEntity } from '../../domain/entities/restaurant-usage.entity';

export class RestaurantUsagePrismaMapper {
  static toDomain(row: PrismaRestaurantUsage): RestaurantUsageEntity {
    return RestaurantUsageEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      branchCount: row.branchCount,
      employeeCount: row.employeeCount,
      updatedAt: row.updatedAt,
    });
  }
}
