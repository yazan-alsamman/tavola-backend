import { MenuItemOption as PrismaMenuItemOption } from '@prisma/client';
import { MenuItemOption } from '../../domain/entities/menu-item-option.entity';

export class MenuItemOptionPrismaMapper {
  static toDomain(row: PrismaMenuItemOption): MenuItemOption {
    return MenuItemOption.reconstitute({
      id: row.id,
      optionGroupId: row.optionGroupId,
      restaurantId: row.restaurantId,
      name: row.name,
      priceModifier: row.priceModifier.toNumber(),
      active: row.active,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(option: MenuItemOption): {
    id: string;
    optionGroupId: string;
    restaurantId: string;
    name: string;
    priceModifier: number;
    active: boolean;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    return { ...option.toProps() };
  }
}
