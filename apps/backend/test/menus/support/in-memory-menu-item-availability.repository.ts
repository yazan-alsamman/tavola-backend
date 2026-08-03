import { MenuItemAvailability } from '@modules/menus/domain/entities/menu-item-availability.entity';
import { MenuItemAvailabilityRepository } from '@modules/menus/domain/repositories/menu-item-availability.repository';
import { MenuItemId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryMenuItemAvailabilityRepository implements MenuItemAvailabilityRepository {
  private readonly rows = new Map<string, MenuItemAvailability[]>();

  async findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemAvailability[]> {
    return this.rows.get(menuItemId.value) ?? [];
  }

  async replaceForMenuItem(menuItemId: MenuItemId, windows: MenuItemAvailability[]): Promise<void> {
    this.rows.set(menuItemId.value, windows);
  }

  async deleteAllForMenuItem(menuItemId: MenuItemId): Promise<void> {
    this.rows.delete(menuItemId.value);
  }
}
