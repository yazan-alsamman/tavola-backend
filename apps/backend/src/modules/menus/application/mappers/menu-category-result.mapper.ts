import { MenuCategory } from '../../domain/entities/menu-category.entity';
import { MenuCategoryResult } from '../dto/menu-category.result';

export function toMenuCategoryResult(category: MenuCategory): MenuCategoryResult {
  return {
    id: category.menuCategoryId.value,
    menuId: category.menuId.value,
    restaurantId: category.restaurantId.value,
    name: category.name,
    description: category.description,
    displayOrder: category.displayOrder,
    imageFileId: category.imageFileId?.value ?? null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
