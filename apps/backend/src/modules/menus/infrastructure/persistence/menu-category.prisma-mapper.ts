import { MenuCategory as PrismaMenuCategory } from '@prisma/client';
import { MenuCategory } from '../../domain/entities/menu-category.entity';

export class MenuCategoryPrismaMapper {
  static toDomain(row: PrismaMenuCategory): MenuCategory {
    return MenuCategory.reconstitute({
      id: row.id,
      menuId: row.menuId,
      restaurantId: row.restaurantId,
      name: row.name,
      description: row.description,
      displayOrder: row.displayOrder,
      imageFileId: row.imageFileId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(category: MenuCategory): {
    id: string;
    menuId: string;
    restaurantId: string;
    name: string;
    description: string | null;
    displayOrder: number;
    imageFileId: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    return { ...category.toProps() };
  }
}
