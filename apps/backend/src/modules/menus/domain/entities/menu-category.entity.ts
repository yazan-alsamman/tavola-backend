import { Entity } from '@shared/domain/base/entity.base';
import {
  MenuCategoryId,
  MenuId,
  RestaurantId,
  FileId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidMenuCategoryException } from '../exceptions/invalid-menu-category.exception';

export interface MenuCategoryProps {
  id: string;
  menuId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  displayOrder: number;
  imageFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MenuCategoryContent {
  name: string;
  description: string | null;
}

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

/** Child of the Menu Aggregate (Phase 18, ADR-031/ADR-032). */
export class MenuCategory extends Entity<MenuCategoryProps> {
  private constructor(props: MenuCategoryProps) {
    super(props);
  }

  static create(props: {
    id: string;
    menuId: string;
    restaurantId: string;
    content: MenuCategoryContent;
    displayOrder: number;
    now: Date;
  }): MenuCategory {
    validateContent(props.content);
    return new MenuCategory({
      id: props.id,
      menuId: props.menuId,
      restaurantId: props.restaurantId,
      ...props.content,
      displayOrder: props.displayOrder,
      imageFileId: null,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuCategoryProps): MenuCategory {
    return new MenuCategory({ ...props });
  }

  get menuCategoryId(): MenuCategoryId {
    return MenuCategoryId.create(this.props.id);
  }

  get menuId(): MenuId {
    return MenuId.create(this.props.menuId);
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

  get displayOrder(): number {
    return this.props.displayOrder;
  }

  get imageFileId(): FileId | null {
    return this.props.imageFileId ? FileId.create(this.props.imageFileId) : null;
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

  update(content: MenuCategoryContent, at: Date): MenuCategory {
    validateContent(content);
    return MenuCategory.reconstitute({ ...this.props, ...content, updatedAt: at });
  }

  updateDisplayOrder(displayOrder: number, at: Date): MenuCategory {
    return MenuCategory.reconstitute({ ...this.props, displayOrder, updatedAt: at });
  }

  setImage(fileId: string, at: Date): MenuCategory {
    return MenuCategory.reconstitute({ ...this.props, imageFileId: fileId, updatedAt: at });
  }

  removeImage(at: Date): MenuCategory {
    return MenuCategory.reconstitute({ ...this.props, imageFileId: null, updatedAt: at });
  }

  softDelete(at: Date): MenuCategory {
    return MenuCategory.reconstitute({ ...this.props, deletedAt: at, updatedAt: at });
  }

  toProps(): Readonly<MenuCategoryProps> {
    return { ...this.props };
  }
}

function validateContent(content: MenuCategoryContent): void {
  if (content.name.trim().length === 0) {
    throw new InvalidMenuCategoryException('name must not be empty.');
  }
  if (content.name.length > MAX_NAME_LENGTH) {
    throw new InvalidMenuCategoryException(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }
  if (content.description !== null && content.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidMenuCategoryException(
      `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
}
