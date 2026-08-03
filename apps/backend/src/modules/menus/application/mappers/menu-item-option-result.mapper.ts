import { MenuItemOption } from '../../domain/entities/menu-item-option.entity';
import { MenuItemOptionResult } from '../dto/menu-item-option.result';

export function toMenuItemOptionResult(option: MenuItemOption): MenuItemOptionResult {
  return {
    id: option.menuItemOptionId.value,
    optionGroupId: option.optionGroupId.value,
    restaurantId: option.restaurantId.value,
    name: option.name,
    priceModifier: option.priceModifier,
    active: option.active,
    displayOrder: option.displayOrder,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  };
}
