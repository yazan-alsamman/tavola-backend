import { MenuItemOptionGroup } from '../../domain/entities/menu-item-option-group.entity';
import { MenuItemOptionGroupResult } from '../dto/menu-item-option-group.result';

export function toMenuItemOptionGroupResult(group: MenuItemOptionGroup): MenuItemOptionGroupResult {
  return {
    id: group.optionGroupId.value,
    menuItemId: group.menuItemId.value,
    restaurantId: group.restaurantId.value,
    name: group.name,
    required: group.required,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    displayOrder: group.displayOrder,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
