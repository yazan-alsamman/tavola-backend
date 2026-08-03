import { MenuItemAddOn } from '../../domain/entities/menu-item-add-on.entity';
import { MenuItemAddOnResult } from '../dto/menu-item-add-on.result';

export function toMenuItemAddOnResult(addOn: MenuItemAddOn): MenuItemAddOnResult {
  return {
    id: addOn.menuItemAddOnId.value,
    menuItemId: addOn.menuItemId.value,
    restaurantId: addOn.restaurantId.value,
    name: addOn.name,
    price: addOn.price,
    active: addOn.active,
    displayOrder: addOn.displayOrder,
    createdAt: addOn.createdAt,
    updatedAt: addOn.updatedAt,
  };
}
