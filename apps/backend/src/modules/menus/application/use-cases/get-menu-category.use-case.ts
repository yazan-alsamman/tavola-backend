import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId, MenuCategoryId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import {
  MenuCategoryRepository,
  MENU_CATEGORY_REPOSITORY,
} from '../../domain/repositories/menu-category.repository';
import { MenuCategoryNotFoundException } from '../../domain/exceptions/menu-category-not-found.exception';
import { resolveMenuImageUrls } from '../services/resolve-menu-image-urls';
import { GetMenuCategoryCommand } from '../dto/menu-category.commands';

export interface MenuCategoryPublicResult {
  id: string;
  menuId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  displayOrder: number;
}

/** Customer-facing public read (DOMAIN_MODEL.md "Get Category"). */
@Injectable()
export class GetMenuCategoryUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
  ) {}

  async execute(command: GetMenuCategoryCommand): Promise<MenuCategoryPublicResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const exists = await this.restaurantRepository.existsPubliclyById(restaurantId);
    if (!exists) {
      throw new RestaurantNotFoundException();
    }

    const category = await this.categoryRepository.findByIdAndRestaurantId(
      MenuCategoryId.create(command.categoryId),
      restaurantId,
    );
    if (category === null) {
      throw new MenuCategoryNotFoundException();
    }

    const imageFileId = category.imageFileId?.value ?? null;
    const urlByFileId = await resolveMenuImageUrls(
      [imageFileId],
      this.fileRepository,
      this.storagePort,
    );

    return {
      id: category.menuCategoryId.value,
      menuId: category.menuId.value,
      name: category.name,
      description: category.description,
      imageUrl: imageFileId ? (urlByFileId.get(imageFileId) ?? null) : null,
      displayOrder: category.displayOrder,
    };
  }
}
