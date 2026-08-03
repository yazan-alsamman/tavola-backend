import { Menu as PrismaMenu } from '@prisma/client';
import { Menu } from '../../domain/entities/menu.entity';

export class MenuPrismaMapper {
  static toDomain(row: PrismaMenu): Menu {
    return Menu.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      name: row.name,
      active: row.active,
      isDefault: row.isDefault,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(menu: Menu): {
    id: string;
    restaurantId: string;
    name: string;
    active: boolean;
    isDefault: boolean;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = menu.toProps();
    return { ...props };
  }
}
