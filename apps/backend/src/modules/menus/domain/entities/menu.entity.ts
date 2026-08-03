import { Entity } from '@shared/domain/base/entity.base';
import { MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidMenuException } from '../exceptions/invalid-menu.exception';

export interface MenuProps {
  id: string;
  restaurantId: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const MAX_NAME_LENGTH = 200;
const DEFAULT_MENU_NAME = 'Main Menu';

/**
 * Menu Aggregate root (Phase 18, architecture frozen 2026-08-02, ADR-031;
 * ownership corrected 2026-08-03, ADR-032). A Restaurant owns 1:N Menus -
 * exactly one non-deleted Menu may be `isDefault`, enforced at the database
 * level by the partial unique index `menus_restaurant_one_default_key`
 * (mirrors `Table.isMergePrimary`, ADR-026), never solely by this in-memory
 * check. `active` is independent of `isDefault`: a Menu can be default but
 * disabled, or enabled but not the default.
 *
 * `name` (e.g. "Breakfast", "Dinner", "QR Menu") was added at implementation
 * time (2026-08-03) - distinguishing multiple Menus is the entire motivation
 * for ADR-032's 1:N ownership change, which is impossible without a label;
 * defaults to "Main Menu" so a Restaurant's first, unrenamed Menu still
 * reads sensibly.
 */
export class Menu extends Entity<MenuProps> {
  private constructor(props: MenuProps) {
    super(props);
  }

  static create(props: {
    id: string;
    restaurantId: string;
    name?: string;
    isDefault: boolean;
    now: Date;
  }): Menu {
    const name = props.name ?? DEFAULT_MENU_NAME;
    validateName(name);
    return new Menu({
      id: props.id,
      restaurantId: props.restaurantId,
      name,
      active: true,
      isDefault: props.isDefault,
      displayOrder: 0,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuProps): Menu {
    return new Menu({ ...props });
  }

  get menuId(): MenuId {
    return MenuId.create(this.props.id);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get name(): string {
    return this.props.name;
  }

  get active(): boolean {
    return this.props.active;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  get displayOrder(): number {
    return this.props.displayOrder;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /** EVENTS.md `MenuUpdated`: name/displayOrder change. */
  update(content: { name: string; displayOrder: number }, at: Date): Menu {
    validateName(content.name);
    return Menu.reconstitute({ ...this.props, ...content, updatedAt: at });
  }

  activate(at: Date): Menu {
    return Menu.reconstitute({ ...this.props, active: true, updatedAt: at });
  }

  deactivate(at: Date): Menu {
    return Menu.reconstitute({ ...this.props, active: false, updatedAt: at });
  }

  /** Only ever called on the Menu being promoted - the repository's `setDefault` atomically unmarks whichever row previously held `isDefault = true`. */
  markAsDefault(at: Date): Menu {
    return Menu.reconstitute({ ...this.props, isDefault: true, updatedAt: at });
  }

  softDelete(at: Date): Menu {
    return Menu.reconstitute({ ...this.props, deletedAt: at, updatedAt: at });
  }

  toProps(): Readonly<MenuProps> {
    return { ...this.props };
  }
}

function validateName(name: string): void {
  if (name.trim().length === 0) {
    throw new InvalidMenuException('name must not be empty.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new InvalidMenuException(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }
}
