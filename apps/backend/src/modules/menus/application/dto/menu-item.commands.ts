import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';
import { UploadedImageFile } from './menu-category.commands';

interface BaseItemCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  menuId: string;
  categoryId: string;
  correlationId?: string;
}

export interface MenuItemContentInput {
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

export interface CreateMenuItemCommand extends BaseItemCommand {
  content: MenuItemContentInput;
}

export interface UpdateMenuItemCommand extends BaseItemCommand {
  itemId: string;
  content: MenuItemContentInput;
  /** EVENTS.md `MenuItemAvailabilityChanged`: fires as part of Update Item, no separate endpoint. */
  availabilityMode: string;
}

export interface DeleteMenuItemCommand extends BaseItemCommand {
  itemId: string;
}

export interface ReorderMenuItemsCommand extends BaseItemCommand {
  orderedMenuItemIds: string[];
}

export interface SetMenuItemFeaturedCommand extends BaseItemCommand {
  itemId: string;
}

export interface AvailabilityWindowInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface ReplaceMenuItemAvailabilityWindowsCommand extends BaseItemCommand {
  itemId: string;
  windows: AvailabilityWindowInput[];
}

export interface UploadMenuItemImageCommand extends BaseItemCommand {
  itemId: string;
  file: UploadedImageFile | null;
}

export interface RemoveMenuItemImageCommand extends BaseItemCommand {
  itemId: string;
}

export interface GetMenuItemCommand {
  restaurantId: string;
  itemId: string;
}
