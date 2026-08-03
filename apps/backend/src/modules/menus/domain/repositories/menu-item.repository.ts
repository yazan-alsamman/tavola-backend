import { MenuItem } from '../entities/menu-item.entity';
import {
  MenuItemId,
  MenuCategoryId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';

/** Transitively tenant-owned via `restaurantId` (denormalized) - same pattern as `Menu`. */
export interface MenuItemRepository {
  create(item: MenuItem): Promise<void>;

  findByIdAndRestaurantId(id: MenuItemId, restaurantId: RestaurantId): Promise<MenuItem | null>;

  /** Non-deleted Items of one Category, ordered by `displayOrder`. */
  findManyByCategoryId(categoryId: MenuCategoryId): Promise<MenuItem[]>;

  update(item: MenuItem): Promise<void>;

  /** Whole-set bulk replacement of `displayOrder`, scoped to one Category's Items - same contract as `MenuCategoryRepository.reorder`. */
  reorder(orderedIds: MenuItemId[], at: Date): Promise<void>;

  softDelete(id: MenuItemId, at: Date): Promise<void>;
}

export const MENU_ITEM_REPOSITORY = Symbol('MENU_ITEM_REPOSITORY');
