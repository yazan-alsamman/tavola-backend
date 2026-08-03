import { MenuResult } from '../../application/dto/menu.result';
import { MenuTreeResult } from '../../application/dto/menu-tree.result';
import { MenuResponseDto } from '../dto/menu.response.dto';
import { MenuTreeResponseDto } from '../dto/menu-tree.response.dto';

export function toMenuResponse(result: MenuResult): MenuResponseDto {
  return {
    id: result.id,
    restaurantId: result.restaurantId,
    name: result.name,
    active: result.active,
    isDefault: result.isDefault,
    displayOrder: result.displayOrder,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toMenuTreeResponse(result: MenuTreeResult): MenuTreeResponseDto {
  return {
    id: result.id,
    restaurantId: result.restaurantId,
    name: result.name,
    active: result.active,
    isDefault: result.isDefault,
    displayOrder: result.displayOrder,
    categories: result.categories.map((category) => ({
      id: category.id,
      menuId: category.menuId,
      name: category.name,
      description: category.description,
      imageUrl: category.imageUrl,
      displayOrder: category.displayOrder,
      items: category.items.map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        price: item.price,
        currency: item.currency,
        imageUrl: item.imageUrl,
        availabilityMode: item.availabilityMode,
        isFeatured: item.isFeatured,
        preparationTimeMinutes: item.preparationTimeMinutes,
        spicyLevel: item.spicyLevel,
        calories: item.calories,
        allergens: item.allergens,
        dietaryLabels: item.dietaryLabels,
        displayOrder: item.displayOrder,
        optionGroups: item.optionGroups,
        addOns: item.addOns,
        availability: item.availability,
      })),
    })),
  };
}
