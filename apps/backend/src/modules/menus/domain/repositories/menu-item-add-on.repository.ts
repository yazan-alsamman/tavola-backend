import { MenuItemAddOn } from '../entities/menu-item-add-on.entity';
import {
  MenuItemAddOnId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';

export interface MenuItemAddOnRepository {
  create(addOn: MenuItemAddOn): Promise<void>;

  findByIdAndRestaurantId(
    id: MenuItemAddOnId,
    restaurantId: RestaurantId,
  ): Promise<MenuItemAddOn | null>;

  /** Non-deleted Add-ons of one Item, ordered by `displayOrder`. */
  findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemAddOn[]>;

  update(addOn: MenuItemAddOn): Promise<void>;

  softDelete(id: MenuItemAddOnId, at: Date): Promise<void>;
}

export const MENU_ITEM_ADD_ON_REPOSITORY = Symbol('MENU_ITEM_ADD_ON_REPOSITORY');
