import { Entity } from '@shared/domain/base/entity.base';
import {
  MenuItemOptionId,
  MenuItemOptionGroupId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidMenuItemOptionException } from '../exceptions/invalid-menu-item-option.exception';

export interface MenuItemOptionProps {
  id: string;
  optionGroupId: string;
  restaurantId: string;
  name: string;
  priceModifier: number;
  active: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MenuItemOptionContent {
  name: string;
  priceModifier: number;
}

const MAX_NAME_LENGTH = 200;

/** Owned by `MenuItemOptionGroup` (Phase 18, ADR-031). `priceModifier` may be zero, positive, or negative. */
export class MenuItemOption extends Entity<MenuItemOptionProps> {
  private constructor(props: MenuItemOptionProps) {
    super(props);
  }

  static create(props: {
    id: string;
    optionGroupId: string;
    restaurantId: string;
    content: MenuItemOptionContent;
    displayOrder: number;
    now: Date;
  }): MenuItemOption {
    validateContent(props.content);
    return new MenuItemOption({
      id: props.id,
      optionGroupId: props.optionGroupId,
      restaurantId: props.restaurantId,
      ...props.content,
      active: true,
      displayOrder: props.displayOrder,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuItemOptionProps): MenuItemOption {
    return new MenuItemOption({ ...props });
  }

  get menuItemOptionId(): MenuItemOptionId {
    return MenuItemOptionId.create(this.props.id);
  }

  get optionGroupId(): MenuItemOptionGroupId {
    return MenuItemOptionGroupId.create(this.props.optionGroupId);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get name(): string {
    return this.props.name;
  }

  get priceModifier(): number {
    return this.props.priceModifier;
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

  update(content: MenuItemOptionContent, at: Date): MenuItemOption {
    validateContent(content);
    return MenuItemOption.reconstitute({ ...this.props, ...content, updatedAt: at });
  }

  activate(at: Date): MenuItemOption {
    return MenuItemOption.reconstitute({ ...this.props, active: true, updatedAt: at });
  }

  deactivate(at: Date): MenuItemOption {
    return MenuItemOption.reconstitute({ ...this.props, active: false, updatedAt: at });
  }

  updateDisplayOrder(displayOrder: number, at: Date): MenuItemOption {
    return MenuItemOption.reconstitute({ ...this.props, displayOrder, updatedAt: at });
  }

  softDelete(at: Date): MenuItemOption {
    return MenuItemOption.reconstitute({ ...this.props, deletedAt: at, updatedAt: at });
  }

  toProps(): Readonly<MenuItemOptionProps> {
    return { ...this.props };
  }
}

function validateContent(content: MenuItemOptionContent): void {
  if (content.name.trim().length === 0) {
    throw new InvalidMenuItemOptionException('name must not be empty.');
  }
  if (content.name.length > MAX_NAME_LENGTH) {
    throw new InvalidMenuItemOptionException(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }
  if (!Number.isFinite(content.priceModifier)) {
    throw new InvalidMenuItemOptionException('priceModifier must be a finite number.');
  }
}
