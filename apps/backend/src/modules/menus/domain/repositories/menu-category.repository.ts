import { MenuCategory } from '../entities/menu-category.entity';
import { MenuCategoryId, MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/** Transitively tenant-owned via `restaurantId` (denormalized) - same pattern as `Menu`. */
export interface MenuCategoryRepository {
  create(category: MenuCategory): Promise<void>;

  findByIdAndRestaurantId(
    id: MenuCategoryId,
    restaurantId: RestaurantId,
  ): Promise<MenuCategory | null>;

  /** Non-deleted Categories of one Menu, ordered by `displayOrder`. */
  findManyByMenuId(menuId: MenuId): Promise<MenuCategory[]>;

  update(category: MenuCategory): Promise<void>;

  /**
   * API_GUIDELINES.md's Bulk Reorder convention: whole-set replacement of
   * `displayOrder`, one transaction. The caller (use case) has already
   * verified `orderedIds` is an exact set match against
   * `findManyByMenuId`'s current non-deleted result before calling this.
   */
  reorder(orderedIds: MenuCategoryId[], at: Date): Promise<void>;

  softDelete(id: MenuCategoryId, at: Date): Promise<void>;
}

export const MENU_CATEGORY_REPOSITORY = Symbol('MENU_CATEGORY_REPOSITORY');
