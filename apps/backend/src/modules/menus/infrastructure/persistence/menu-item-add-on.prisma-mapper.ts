import { MenuItemAddOn as PrismaMenuItemAddOn } from '@prisma/client';
import { MenuItemAddOn } from '../../domain/entities/menu-item-add-on.entity';

export class MenuItemAddOnPrismaMapper {
  static toDomain(row: PrismaMenuItemAddOn): MenuItemAddOn {
    return MenuItemAddOn.reconstitute({
      id: row.id,
      menuItemId: row.menuItemId,
      restaurantId: row.restaurantId,
      name: row.name,
      price: row.price.toNumber(),
      active: row.active,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(addOn: MenuItemAddOn): {
    id: string;
    menuItemId: string;
    restaurantId: string;
    name: string;
    price: number;
    active: boolean;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    return { ...addOn.toProps() };
  }
}
