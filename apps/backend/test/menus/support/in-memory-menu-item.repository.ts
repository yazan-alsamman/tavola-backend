import { MenuItem } from '@modules/menus/domain/entities/menu-item.entity';
import { MenuItemRepository } from '@modules/menus/domain/repositories/menu-item.repository';
import {
  MenuItemId,
  MenuCategoryId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryMenuItemRepository implements MenuItemRepository {
  private readonly rows = new Map<string, MenuItem>();

  async create(item: MenuItem): Promise<void> {
    this.rows.set(item.menuItemId.value, item);
  }

  async findByIdAndRestaurantId(
    id: MenuItemId,
    restaurantId: RestaurantId,
  ): Promise<MenuItem | null> {
    const row = this.rows.get(id.value);
    if (!row || row.isDeleted() || row.restaurantId.value !== restaurantId.value) {
      return null;
    }
    return row;
  }

  async findManyByCategoryId(categoryId: MenuCategoryId): Promise<MenuItem[]> {
    return [...this.rows.values()]
      .filter((row) => row.categoryId.value === categoryId.value && !row.isDeleted())
      .sort(
        (a, b) => a.displayOrder - b.displayOrder || a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async update(item: MenuItem): Promise<void> {
    this.rows.set(item.menuItemId.value, item);
  }

  async reorder(orderedIds: MenuItemId[], at: Date): Promise<void> {
    orderedIds.forEach((id, index) => {
      const current = this.rows.get(id.value);
      if (current) {
        this.rows.set(id.value, current.updateDisplayOrder(index, at));
      }
    });
  }

  async softDelete(id: MenuItemId, at: Date): Promise<void> {
    const current = this.rows.get(id.value);
    if (!current || current.isDeleted()) {
      return;
    }
    this.rows.set(id.value, current.softDelete(at));
  }

  seed(item: MenuItem): void {
    this.rows.set(item.menuItemId.value, item);
  }
}
