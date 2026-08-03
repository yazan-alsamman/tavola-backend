import { MenuItemAvailability } from '../entities/menu-item-availability.entity';
import { MenuItemId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `deletedAt` on this model (matching `WorkingHours`/`BranchWorkingHours`)
 * - windows are always whole-set replaced, never individually soft-deleted.
 */
export interface MenuItemAvailabilityRepository {
  findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemAvailability[]>;

  /**
   * Deletes every existing row for `menuItemId` and inserts `windows` as a
   * fresh set, in one transaction (same whole-set-replacement semantics as
   * `MenuCategoryRepository.reorder`). Each window is already a fully
   * validated, id-assigned `MenuItemAvailability` entity built by the
   * calling use case (`MenuItemAvailability.create`) - the repository
   * never invents ids of its own. An empty array clears all availability
   * windows for the Item.
   */
  replaceForMenuItem(menuItemId: MenuItemId, windows: MenuItemAvailability[]): Promise<void>;

  deleteAllForMenuItem(menuItemId: MenuItemId): Promise<void>;
}

export const MENU_ITEM_AVAILABILITY_REPOSITORY = Symbol('MENU_ITEM_AVAILABILITY_REPOSITORY');
