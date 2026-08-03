import { Menu } from '../../domain/entities/menu.entity';
import { MenuResult } from '../dto/menu.result';

export function toMenuResult(menu: Menu): MenuResult {
  return {
    id: menu.menuId.value,
    restaurantId: menu.restaurantId.value,
    name: menu.name,
    active: menu.active,
    isDefault: menu.isDefault,
    displayOrder: menu.displayOrder,
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
  };
}
