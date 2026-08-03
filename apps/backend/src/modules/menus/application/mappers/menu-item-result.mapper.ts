import { MenuItem } from '../../domain/entities/menu-item.entity';
import { MenuItemResult } from '../dto/menu-item.result';

export function toMenuItemResult(item: MenuItem): MenuItemResult {
  return {
    id: item.menuItemId.value,
    categoryId: item.categoryId.value,
    restaurantId: item.restaurantId.value,
    name: item.name,
    description: item.description,
    price: item.price,
    currency: item.currency,
    imageFileId: item.imageFileId?.value ?? null,
    availabilityMode: item.availabilityMode,
    isFeatured: item.isFeatured,
    preparationTimeMinutes: item.preparationTimeMinutes,
    spicyLevel: item.spicyLevel,
    calories: item.calories,
    allergens: item.allergens,
    dietaryLabels: item.dietaryLabels,
    displayOrder: item.displayOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
