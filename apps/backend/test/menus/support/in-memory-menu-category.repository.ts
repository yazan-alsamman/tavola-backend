import { MenuCategory } from '@modules/menus/domain/entities/menu-category.entity';
import { MenuCategoryRepository } from '@modules/menus/domain/repositories/menu-category.repository';
import { MenuCategoryId, MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryMenuCategoryRepository implements MenuCategoryRepository {
  private readonly rows = new Map<string, MenuCategory>();

  async create(category: MenuCategory): Promise<void> {
    this.rows.set(category.menuCategoryId.value, category);
  }

  async findByIdAndRestaurantId(
    id: MenuCategoryId,
    restaurantId: RestaurantId,
  ): Promise<MenuCategory | null> {
    const row = this.rows.get(id.value);
    if (!row || row.isDeleted() || row.restaurantId.value !== restaurantId.value) {
      return null;
    }
    return row;
  }

  async findManyByMenuId(menuId: MenuId): Promise<MenuCategory[]> {
    return [...this.rows.values()]
      .filter((row) => row.menuId.value === menuId.value && !row.isDeleted())
      .sort(
        (a, b) => a.displayOrder - b.displayOrder || a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async update(category: MenuCategory): Promise<void> {
    this.rows.set(category.menuCategoryId.value, category);
  }

  async reorder(orderedIds: MenuCategoryId[], at: Date): Promise<void> {
    orderedIds.forEach((id, index) => {
      const current = this.rows.get(id.value);
      if (current) {
        this.rows.set(id.value, current.updateDisplayOrder(index, at));
      }
    });
  }

  async softDelete(id: MenuCategoryId, at: Date): Promise<void> {
    const current = this.rows.get(id.value);
    if (!current || current.isDeleted()) {
      return;
    }
    this.rows.set(id.value, current.softDelete(at));
  }

  seed(category: MenuCategory): void {
    this.rows.set(category.menuCategoryId.value, category);
  }
}
