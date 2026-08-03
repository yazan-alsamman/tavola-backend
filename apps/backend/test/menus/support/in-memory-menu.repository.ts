import { Menu } from '@modules/menus/domain/entities/menu.entity';
import { MenuRepository } from '@modules/menus/domain/repositories/menu.repository';
import { MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/** Test double mirroring `PrismaMenuRepository`'s semantics for unit tests that need no real database. */
export class InMemoryMenuRepository implements MenuRepository {
  private readonly rows = new Map<string, Menu>();

  async create(menu: Menu): Promise<void> {
    this.rows.set(menu.menuId.value, menu);
  }

  async findByIdAndRestaurantId(id: MenuId, restaurantId: RestaurantId): Promise<Menu | null> {
    const row = this.rows.get(id.value);
    if (!row || row.isDeleted() || row.restaurantId.value !== restaurantId.value) {
      return null;
    }
    return row;
  }

  async findManyByRestaurantId(restaurantId: RestaurantId): Promise<Menu[]> {
    return [...this.rows.values()]
      .filter((row) => row.restaurantId.value === restaurantId.value && !row.isDeleted())
      .sort(
        (a, b) => a.displayOrder - b.displayOrder || a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async findDefaultByRestaurantId(restaurantId: RestaurantId): Promise<Menu | null> {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.restaurantId.value === restaurantId.value &&
          row.isDefault &&
          row.active &&
          !row.isDeleted(),
      ) ?? null
    );
  }

  async existsAnyForRestaurant(restaurantId: RestaurantId): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) => row.restaurantId.value === restaurantId.value && !row.isDeleted(),
    );
  }

  async update(menu: Menu): Promise<void> {
    this.rows.set(menu.menuId.value, menu);
  }

  async setAsDefault(menuId: MenuId, restaurantId: RestaurantId, at: Date): Promise<void> {
    for (const [id, row] of this.rows.entries()) {
      if (row.restaurantId.value === restaurantId.value && row.isDefault) {
        this.rows.set(id, Menu.reconstitute({ ...row.toProps(), isDefault: false, updatedAt: at }));
      }
    }
    const target = this.rows.get(menuId.value);
    if (target) {
      this.rows.set(menuId.value, target.markAsDefault(at));
    }
  }

  async softDelete(id: MenuId, at: Date): Promise<void> {
    const current = this.rows.get(id.value);
    if (!current || current.isDeleted()) {
      return;
    }
    this.rows.set(id.value, current.softDelete(at));
  }

  async findRestaurantIdsWithActiveDefaultMenu(
    restaurantIds: RestaurantId[],
  ): Promise<Set<string>> {
    const wanted = new Set(restaurantIds.map((id) => id.value));
    const found = new Set<string>();
    for (const row of this.rows.values()) {
      if (wanted.has(row.restaurantId.value) && row.isDefault && row.active && !row.isDeleted()) {
        found.add(row.restaurantId.value);
      }
    }
    return found;
  }

  /** Test-only helper: seeds a row directly. */
  seed(menu: Menu): void {
    this.rows.set(menu.menuId.value, menu);
  }
}
