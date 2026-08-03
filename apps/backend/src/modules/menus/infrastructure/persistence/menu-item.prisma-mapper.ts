import { MenuItem as PrismaMenuItem } from '@prisma/client';
import { MenuItem } from '../../domain/entities/menu-item.entity';
import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export class MenuItemPrismaMapper {
  static toDomain(row: PrismaMenuItem): MenuItem {
    return MenuItem.reconstitute({
      id: row.id,
      categoryId: row.categoryId,
      restaurantId: row.restaurantId,
      name: row.name,
      description: row.description,
      price: row.price.toNumber(),
      currency: row.currency,
      imageFileId: row.imageFileId,
      availabilityMode: row.availabilityMode as MenuItemAvailabilityMode,
      isFeatured: row.isFeatured,
      preparationTimeMinutes: row.preparationTimeMinutes,
      spicyLevel: row.spicyLevel,
      calories: row.calories,
      allergens: row.allergens,
      dietaryLabels: row.dietaryLabels as MenuItemDietaryLabel[],
      displayOrder: row.displayOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(item: MenuItem): {
    id: string;
    categoryId: string;
    restaurantId: string;
    name: string;
    description: string | null;
    price: number;
    currency: string | null;
    imageFileId: string | null;
    availabilityMode: MenuItemAvailabilityMode;
    isFeatured: boolean;
    preparationTimeMinutes: number | null;
    spicyLevel: number | null;
    calories: number | null;
    allergens: string[];
    dietaryLabels: MenuItemDietaryLabel[];
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = item.toProps();
    return { ...props };
  }
}
