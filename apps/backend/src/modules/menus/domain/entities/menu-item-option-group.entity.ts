import { Entity } from '@shared/domain/base/entity.base';
import {
  MenuItemOptionGroupId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidMenuItemOptionGroupException } from '../exceptions/invalid-menu-item-option-group.exception';

export interface MenuItemOptionGroupProps {
  id: string;
  menuItemId: string;
  restaurantId: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MenuItemOptionGroupContent {
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
}

const MAX_NAME_LENGTH = 200;

/** Owned by `MenuItem`, not a direct child of `Menu` (Phase 18, ADR-031). */
export class MenuItemOptionGroup extends Entity<MenuItemOptionGroupProps> {
  private constructor(props: MenuItemOptionGroupProps) {
    super(props);
  }

  static create(props: {
    id: string;
    menuItemId: string;
    restaurantId: string;
    content: MenuItemOptionGroupContent;
    displayOrder: number;
    now: Date;
  }): MenuItemOptionGroup {
    validateContent(props.content);
    return new MenuItemOptionGroup({
      id: props.id,
      menuItemId: props.menuItemId,
      restaurantId: props.restaurantId,
      ...props.content,
      displayOrder: props.displayOrder,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuItemOptionGroupProps): MenuItemOptionGroup {
    return new MenuItemOptionGroup({ ...props });
  }

  get optionGroupId(): MenuItemOptionGroupId {
    return MenuItemOptionGroupId.create(this.props.id);
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

  get required(): boolean {
    return this.props.required;
  }

  get minSelections(): number {
    return this.props.minSelections;
  }

  get maxSelections(): number {
    return this.props.maxSelections;
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

  update(content: MenuItemOptionGroupContent, at: Date): MenuItemOptionGroup {
    validateContent(content);
    return MenuItemOptionGroup.reconstitute({ ...this.props, ...content, updatedAt: at });
  }

  updateDisplayOrder(displayOrder: number, at: Date): MenuItemOptionGroup {
    return MenuItemOptionGroup.reconstitute({ ...this.props, displayOrder, updatedAt: at });
  }

  softDelete(at: Date): MenuItemOptionGroup {
    return MenuItemOptionGroup.reconstitute({ ...this.props, deletedAt: at, updatedAt: at });
  }

  toProps(): Readonly<MenuItemOptionGroupProps> {
    return { ...this.props };
  }
}

function validateContent(content: MenuItemOptionGroupContent): void {
  if (content.name.trim().length === 0) {
    throw new InvalidMenuItemOptionGroupException('name must not be empty.');
  }
  if (content.name.length > MAX_NAME_LENGTH) {
    throw new InvalidMenuItemOptionGroupException(
      `name must not exceed ${MAX_NAME_LENGTH} characters.`,
    );
  }
  if (!Number.isInteger(content.minSelections) || content.minSelections < 0) {
    throw new InvalidMenuItemOptionGroupException('minSelections must be a non-negative integer.');
  }
  if (!Number.isInteger(content.maxSelections) || content.maxSelections < 1) {
    throw new InvalidMenuItemOptionGroupException('maxSelections must be a positive integer.');
  }
  if (content.minSelections > content.maxSelections) {
    throw new InvalidMenuItemOptionGroupException('minSelections must not exceed maxSelections.');
  }
  if (content.required && content.minSelections < 1) {
    throw new InvalidMenuItemOptionGroupException(
      'A required option group must have minSelections of at least 1.',
    );
  }
}
