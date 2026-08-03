import { MenuCategoryResult } from '../../application/dto/menu-category.result';
import { MenuCategoryPublicResult } from '../../application/use-cases/get-menu-category.use-case';
import { MenuCategoryResponseDto } from '../dto/menu-category.response.dto';
import { MenuCategoryPublicResponseDto } from '../dto/menu-category-public.response.dto';

export function toMenuCategoryResponse(result: MenuCategoryResult): MenuCategoryResponseDto {
  return {
    id: result.id,
    menuId: result.menuId,
    restaurantId: result.restaurantId,
    name: result.name,
    description: result.description,
    displayOrder: result.displayOrder,
    imageFileId: result.imageFileId,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toMenuCategoryPublicResponse(
  result: MenuCategoryPublicResult,
): MenuCategoryPublicResponseDto {
  return {
    id: result.id,
    menuId: result.menuId,
    name: result.name,
    description: result.description,
    imageUrl: result.imageUrl,
    displayOrder: result.displayOrder,
  };
}
