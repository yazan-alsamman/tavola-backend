import { MenuItemOptionGroup as PrismaMenuItemOptionGroup } from '@prisma/client';
import { MenuItemOptionGroup } from '../../domain/entities/menu-item-option-group.entity';

export class MenuItemOptionGroupPrismaMapper {
  static toDomain(row: PrismaMenuItemOptionGroup): MenuItemOptionGroup {
    return MenuItemOptionGroup.reconstitute({
      id: row.id,
      menuItemId: row.menuItemId,
      restaurantId: row.restaurantId,
      name: row.name,
      required: row.required,
      minSelections: row.minSelections,
      maxSelections: row.maxSelections,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(group: MenuItemOptionGroup): {
    id: string;
    menuItemId: string;
    restaurantId: string;
    name: string;
    required: boolean;
    minSelections: number;
    maxSelections: number;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    return { ...group.toProps() };
  }
}
