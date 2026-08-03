import { MenuItemAvailability as PrismaMenuItemAvailability } from '@prisma/client';
import { MenuItemAvailability } from '../../domain/entities/menu-item-availability.entity';

export class MenuItemAvailabilityPrismaMapper {
  static toDomain(row: PrismaMenuItemAvailability): MenuItemAvailability {
    return MenuItemAvailability.reconstitute({
      id: row.id,
      menuItemId: row.menuItemId,
      restaurantId: row.restaurantId,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
