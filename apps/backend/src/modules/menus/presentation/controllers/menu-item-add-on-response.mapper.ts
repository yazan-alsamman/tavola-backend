import { MenuItemAddOnResult } from '../../application/dto/menu-item-add-on.result';
import { MenuItemAddOnResponseDto } from '../dto/menu-item-add-on.response.dto';

export function toMenuItemAddOnResponse(result: MenuItemAddOnResult): MenuItemAddOnResponseDto {
  return {
    id: result.id,
    menuItemId: result.menuItemId,
    restaurantId: result.restaurantId,
    name: result.name,
    price: result.price,
    active: result.active,
    displayOrder: result.displayOrder,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
