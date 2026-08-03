import { MenuItemOptionGroupResult } from '../../application/dto/menu-item-option-group.result';
import { MenuItemOptionResult } from '../../application/dto/menu-item-option.result';
import { MenuItemOptionGroupResponseDto } from '../dto/menu-item-option-group.response.dto';
import { MenuItemOptionResponseDto } from '../dto/menu-item-option.response.dto';

export function toMenuItemOptionGroupResponse(
  result: MenuItemOptionGroupResult,
): MenuItemOptionGroupResponseDto {
  return {
    id: result.id,
    menuItemId: result.menuItemId,
    restaurantId: result.restaurantId,
    name: result.name,
    required: result.required,
    minSelections: result.minSelections,
    maxSelections: result.maxSelections,
    displayOrder: result.displayOrder,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toMenuItemOptionResponse(result: MenuItemOptionResult): MenuItemOptionResponseDto {
  return {
    id: result.id,
    optionGroupId: result.optionGroupId,
    restaurantId: result.restaurantId,
    name: result.name,
    priceModifier: result.priceModifier,
    active: result.active,
    displayOrder: result.displayOrder,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
