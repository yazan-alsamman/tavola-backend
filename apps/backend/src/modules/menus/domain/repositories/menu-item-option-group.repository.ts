import { MenuItemOptionGroup } from '../entities/menu-item-option-group.entity';
import {
  MenuItemOptionGroupId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';

export interface MenuItemOptionGroupRepository {
  create(group: MenuItemOptionGroup): Promise<void>;

  findByIdAndRestaurantId(
    id: MenuItemOptionGroupId,
    restaurantId: RestaurantId,
  ): Promise<MenuItemOptionGroup | null>;

  /** Non-deleted Option Groups of one Item, ordered by `displayOrder`. */
  findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemOptionGroup[]>;

  update(group: MenuItemOptionGroup): Promise<void>;

  softDelete(id: MenuItemOptionGroupId, at: Date): Promise<void>;
}

export const MENU_ITEM_OPTION_GROUP_REPOSITORY = Symbol('MENU_ITEM_OPTION_GROUP_REPOSITORY');
