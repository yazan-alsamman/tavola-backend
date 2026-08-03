import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId, MenuItemId } from '@shared/domain/value-objects/identifiers.vo';
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
  MenuItemRepository,
  MENU_ITEM_REPOSITORY,
} from '../../domain/repositories/menu-item.repository';
import { MenuItemNotFoundException } from '../../domain/exceptions/menu-item-not-found.exception';
import {
  MenuItemOptionGroupRepository,
  MENU_ITEM_OPTION_GROUP_REPOSITORY,
} from '../../domain/repositories/menu-item-option-group.repository';
import {
  MenuItemOptionRepository,
  MENU_ITEM_OPTION_REPOSITORY,
} from '../../domain/repositories/menu-item-option.repository';
import {
  MenuItemAddOnRepository,
  MENU_ITEM_ADD_ON_REPOSITORY,
} from '../../domain/repositories/menu-item-add-on.repository';
import {
  MenuItemAvailabilityRepository,
  MENU_ITEM_AVAILABILITY_REPOSITORY,
} from '../../domain/repositories/menu-item-availability.repository';
import { resolveMenuImageUrls } from '../services/resolve-menu-image-urls';
import { GetMenuItemCommand } from '../dto/menu-item.commands';
import { MenuItemTreeResult } from '../dto/menu-tree.result';

/** Customer-facing public read (DOMAIN_MODEL.md "Get Item Details"). */
@Injectable()
export class GetMenuItemUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(MENU_ITEM_OPTION_GROUP_REPOSITORY)
    private readonly optionGroupRepository: MenuItemOptionGroupRepository,
    @Inject(MENU_ITEM_OPTION_REPOSITORY)
    private readonly optionRepository: MenuItemOptionRepository,
    @Inject(MENU_ITEM_ADD_ON_REPOSITORY) private readonly addOnRepository: MenuItemAddOnRepository,
    @Inject(MENU_ITEM_AVAILABILITY_REPOSITORY)
    private readonly availabilityRepository: MenuItemAvailabilityRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
  ) {}

  async execute(command: GetMenuItemCommand): Promise<MenuItemTreeResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const exists = await this.restaurantRepository.existsPubliclyById(restaurantId);
    if (!exists) {
      throw new RestaurantNotFoundException();
    }

    const itemId = MenuItemId.create(command.itemId);
    const item = await this.itemRepository.findByIdAndRestaurantId(itemId, restaurantId);
    if (item === null) {
      throw new MenuItemNotFoundException();
    }

    const [optionGroups, addOns, availability] = await Promise.all([
      this.optionGroupRepository.findManyByMenuItemId(itemId),
      this.addOnRepository.findManyByMenuItemId(itemId),
      this.availabilityRepository.findManyByMenuItemId(itemId),
    ]);
    const optionsByGroup = await Promise.all(
      optionGroups.map((group) =>
        this.optionRepository.findManyByOptionGroupId(group.optionGroupId),
      ),
    );

    const imageFileId = item.imageFileId?.value ?? null;
    const urlByFileId = await resolveMenuImageUrls(
      [imageFileId],
      this.fileRepository,
      this.storagePort,
    );

    return {
      id: item.menuItemId.value,
      categoryId: item.categoryId.value,
      name: item.name,
      description: item.description,
      price: item.price,
      currency: item.currency,
      imageUrl: imageFileId ? (urlByFileId.get(imageFileId) ?? null) : null,
      availabilityMode: item.availabilityMode,
      isFeatured: item.isFeatured,
      preparationTimeMinutes: item.preparationTimeMinutes,
      spicyLevel: item.spicyLevel,
      calories: item.calories,
      allergens: item.allergens,
      dietaryLabels: item.dietaryLabels,
      displayOrder: item.displayOrder,
      optionGroups: optionGroups.map((group, index) => ({
        id: group.optionGroupId.value,
        name: group.name,
        required: group.required,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        displayOrder: group.displayOrder,
        options: optionsByGroup[index]
          .filter((o) => o.active)
          .map((o) => ({
            id: o.menuItemOptionId.value,
            name: o.name,
            priceModifier: o.priceModifier,
            active: o.active,
            displayOrder: o.displayOrder,
          })),
      })),
      addOns: addOns
        .filter((a) => a.active)
        .map((a) => ({
          id: a.menuItemAddOnId.value,
          name: a.name,
          price: a.price,
          active: a.active,
          displayOrder: a.displayOrder,
        })),
      availability: availability.map((w) => ({
        dayOfWeek: w.dayOfWeek,
        startTime: w.startTime,
        endTime: w.endTime,
      })),
    };
  }
}
