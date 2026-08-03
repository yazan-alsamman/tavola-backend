import { Entity } from '@shared/domain/base/entity.base';
import {
  MenuItemId,
  MenuCategoryId,
  RestaurantId,
  FileId,
} from '@shared/domain/value-objects/identifiers.vo';
import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../enums/menu-item.enums';
import { InvalidMenuItemException } from '../exceptions/invalid-menu-item.exception';

export interface MenuItemProps {
  id: string;
  categoryId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  imageFileId: string | null;
  availabilityMode: MenuItemAvailabilityMode;
  isFeatured: boolean;
  preparationTimeMinutes: number | null;
  spicyLevel: number | null;
  calories: number | null;
  allergens: string[];
  dietaryLabels: MenuItemDietaryLabel[];
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MenuItemContent {
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  preparationTimeMinutes: number | null;
  spicyLevel: number | null;
  calories: number | null;
  allergens: string[];
  dietaryLabels: MenuItemDietaryLabel[];
}

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_SPICY_LEVEL = 0;
const MAX_SPICY_LEVEL = 3;

/**
 * Child of the Menu Aggregate (Phase 18, ADR-031; availability/isFeatured
 * corrected 2026-08-03, ADR-032). `availabilityMode = Scheduled` requires at
 * least one sibling `MenuItemAvailability` row to exist - enforced by the
 * application layer (`ReplaceMenuItemAvailabilityWindowsUseCase`/
 * `UpdateMenuItemUseCase`), not by this entity in isolation, since the
 * windows live in a separate table this entity does not hold a reference to.
 */
export class MenuItem extends Entity<MenuItemProps> {
  private constructor(props: MenuItemProps) {
    super(props);
  }

  static create(props: {
    id: string;
    categoryId: string;
    restaurantId: string;
    content: MenuItemContent;
    displayOrder: number;
    now: Date;
  }): MenuItem {
    validateContent(props.content);
    return new MenuItem({
      id: props.id,
      categoryId: props.categoryId,
      restaurantId: props.restaurantId,
      ...props.content,
      imageFileId: null,
      availabilityMode: MenuItemAvailabilityMode.Always,
      isFeatured: false,
      displayOrder: props.displayOrder,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuItemProps): MenuItem {
    return new MenuItem({ ...props });
  }

  get menuItemId(): MenuItemId {
    return MenuItemId.create(this.props.id);
  }

  get categoryId(): MenuCategoryId {
    return MenuCategoryId.create(this.props.categoryId);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get price(): number {
    return this.props.price;
  }

  get currency(): string | null {
    return this.props.currency;
  }

  get imageFileId(): FileId | null {
    return this.props.imageFileId ? FileId.create(this.props.imageFileId) : null;
  }

  get availabilityMode(): MenuItemAvailabilityMode {
    return this.props.availabilityMode;
  }

  get isFeatured(): boolean {
    return this.props.isFeatured;
  }

  get preparationTimeMinutes(): number | null {
    return this.props.preparationTimeMinutes;
  }

  get spicyLevel(): number | null {
    return this.props.spicyLevel;
  }

  get calories(): number | null {
    return this.props.calories;
  }

  get allergens(): string[] {
    return [...this.props.allergens];
  }

  get dietaryLabels(): MenuItemDietaryLabel[] {
    return [...this.props.dietaryLabels];
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

  update(content: MenuItemContent, at: Date): MenuItem {
    validateContent(content);
    return MenuItem.reconstitute({ ...this.props, ...content, updatedAt: at });
  }

  updateDisplayOrder(displayOrder: number, at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, displayOrder, updatedAt: at });
  }

  changeAvailabilityMode(mode: MenuItemAvailabilityMode, at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, availabilityMode: mode, updatedAt: at });
  }

  feature(at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, isFeatured: true, updatedAt: at });
  }

  unfeature(at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, isFeatured: false, updatedAt: at });
  }

  setImage(fileId: string, at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, imageFileId: fileId, updatedAt: at });
  }

  removeImage(at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, imageFileId: null, updatedAt: at });
  }

  softDelete(at: Date): MenuItem {
    return MenuItem.reconstitute({ ...this.props, deletedAt: at, updatedAt: at });
  }

  toProps(): Readonly<MenuItemProps> {
    return { ...this.props };
  }
}

function validateContent(content: MenuItemContent): void {
  if (content.name.trim().length === 0) {
    throw new InvalidMenuItemException('name must not be empty.');
  }
  if (content.name.length > MAX_NAME_LENGTH) {
    throw new InvalidMenuItemException(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }
  if (content.description !== null && content.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidMenuItemException(
      `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  if (!Number.isFinite(content.price) || content.price < 0) {
    throw new InvalidMenuItemException('price must be a non-negative finite number.');
  }
  if (
    content.preparationTimeMinutes !== null &&
    (!Number.isInteger(content.preparationTimeMinutes) || content.preparationTimeMinutes < 0)
  ) {
    throw new InvalidMenuItemException('preparationTimeMinutes must be a non-negative integer.');
  }
  if (
    content.spicyLevel !== null &&
    (!Number.isInteger(content.spicyLevel) ||
      content.spicyLevel < MIN_SPICY_LEVEL ||
      content.spicyLevel > MAX_SPICY_LEVEL)
  ) {
    throw new InvalidMenuItemException(
      `spicyLevel must be an integer between ${MIN_SPICY_LEVEL} and ${MAX_SPICY_LEVEL}.`,
    );
  }
  if (content.calories !== null && (!Number.isInteger(content.calories) || content.calories < 0)) {
    throw new InvalidMenuItemException('calories must be a non-negative integer.');
  }
}
