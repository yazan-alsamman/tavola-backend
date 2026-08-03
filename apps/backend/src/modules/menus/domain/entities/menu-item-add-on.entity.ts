import { Entity } from '@shared/domain/base/entity.base';
import {
  MenuItemAddOnId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidMenuItemAddOnException } from '../exceptions/invalid-menu-item-add-on.exception';

export interface MenuItemAddOnProps {
  id: string;
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: number;
  active: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MenuItemAddOnContent {
  name: string;
  price: number;
}

const MAX_NAME_LENGTH = 200;

/** Owned by `MenuItem`, sibling of `MenuItemOptionGroup`, not nested under it (Phase 18, ADR-031). */
export class MenuItemAddOn extends Entity<MenuItemAddOnProps> {
  private constructor(props: MenuItemAddOnProps) {
    super(props);
  }

  static create(props: {
    id: string;
    menuItemId: string;
    restaurantId: string;
    content: MenuItemAddOnContent;
    displayOrder: number;
    now: Date;
  }): MenuItemAddOn {
    validateContent(props.content);
    return new MenuItemAddOn({
      id: props.id,
      menuItemId: props.menuItemId,
      restaurantId: props.restaurantId,
      ...props.content,
      active: true,
      displayOrder: props.displayOrder,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuItemAddOnProps): MenuItemAddOn {
    return new MenuItemAddOn({ ...props });
  }

  get menuItemAddOnId(): MenuItemAddOnId {
    return MenuItemAddOnId.create(this.props.id);
  }

  get menuItemId(): MenuItemId {
    return MenuItemId.create(this.props.menuItemId);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get name(): string {
    return this.props.name;
  }

  get price(): number {
    return this.props.price;
  }

  get active(): boolean {
    return this.props.active;
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

  update(content: MenuItemAddOnContent, at: Date): MenuItemAddOn {
    validateContent(content);
    return MenuItemAddOn.reconstitute({ ...this.props, ...content, updatedAt: at });
  }

  activate(at: Date): MenuItemAddOn {
    return MenuItemAddOn.reconstitute({ ...this.props, active: true, updatedAt: at });
  }

  deactivate(at: Date): MenuItemAddOn {
    return MenuItemAddOn.reconstitute({ ...this.props, active: false, updatedAt: at });
  }

  updateDisplayOrder(displayOrder: number, at: Date): MenuItemAddOn {
    return MenuItemAddOn.reconstitute({ ...this.props, displayOrder, updatedAt: at });
  }

  softDelete(at: Date): MenuItemAddOn {
    return MenuItemAddOn.reconstitute({ ...this.props, deletedAt: at, updatedAt: at });
  }

  toProps(): Readonly<MenuItemAddOnProps> {
    return { ...this.props };
  }
}

function validateContent(content: MenuItemAddOnContent): void {
  if (content.name.trim().length === 0) {
    throw new InvalidMenuItemAddOnException('name must not be empty.');
  }
  if (content.name.length > MAX_NAME_LENGTH) {
    throw new InvalidMenuItemAddOnException(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }
  if (!Number.isFinite(content.price) || content.price < 0) {
    throw new InvalidMenuItemAddOnException('price must be a non-negative finite number.');
  }
}
