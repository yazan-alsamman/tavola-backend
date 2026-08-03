import { MenuItemResult } from '../../application/dto/menu-item.result';
import { MenuItemTreeResult } from '../../application/dto/menu-tree.result';
import { MenuItemResponseDto } from '../dto/menu-item.response.dto';
import { MenuItemTreeResponseDto } from '../dto/menu-tree.response.dto';

export function toMenuItemResponse(result: MenuItemResult): MenuItemResponseDto {
  return {
    id: result.id,
    categoryId: result.categoryId,
    restaurantId: result.restaurantId,
    name: result.name,
    description: result.description,
    price: result.price,
    currency: result.currency,
    imageFileId: result.imageFileId,
    availabilityMode: result.availabilityMode,
    isFeatured: result.isFeatured,
    preparationTimeMinutes: result.preparationTimeMinutes,
    spicyLevel: result.spicyLevel,
    calories: result.calories,
    allergens: result.allergens,
    dietaryLabels: result.dietaryLabels,
    displayOrder: result.displayOrder,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toMenuItemPublicResponse(result: MenuItemTreeResult): MenuItemTreeResponseDto {
  return { ...result };
}
