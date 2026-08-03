import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

interface BaseCategoryCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  menuId: string;
  correlationId?: string;
}

export interface CreateMenuCategoryCommand extends BaseCategoryCommand {
  name: string;
  description: string | null;
}

export interface UpdateMenuCategoryCommand extends BaseCategoryCommand {
  categoryId: string;
  name: string;
  description: string | null;
}

export interface DeleteMenuCategoryCommand extends BaseCategoryCommand {
  categoryId: string;
}

export interface ReorderMenuCategoriesCommand extends BaseCategoryCommand {
  orderedCategoryIds: string[];
}

export interface UploadedImageFile {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadMenuCategoryImageCommand extends BaseCategoryCommand {
  categoryId: string;
  file: UploadedImageFile | null;
}

export interface RemoveMenuCategoryImageCommand extends BaseCategoryCommand {
  categoryId: string;
}

export interface GetMenuCategoryCommand {
  restaurantId: string;
  categoryId: string;
}
