import { MenuItemOption } from '../entities/menu-item-option.entity';
import {
  MenuItemOptionId,
  MenuItemOptionGroupId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';

export interface MenuItemOptionRepository {
  create(option: MenuItemOption): Promise<void>;

  findByIdAndRestaurantId(
    id: MenuItemOptionId,
    restaurantId: RestaurantId,
  ): Promise<MenuItemOption | null>;

  /** Non-deleted Options of one Option Group, ordered by `displayOrder`. */
  findManyByOptionGroupId(optionGroupId: MenuItemOptionGroupId): Promise<MenuItemOption[]>;

  update(option: MenuItemOption): Promise<void>;

  softDelete(id: MenuItemOptionId, at: Date): Promise<void>;
}

export const MENU_ITEM_OPTION_REPOSITORY = Symbol('MENU_ITEM_OPTION_REPOSITORY');
