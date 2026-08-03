import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId, MenuId } from '@shared/domain/value-objects/identifiers.vo';
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
import { MenuRepository, MENU_REPOSITORY } from '../../domain/repositories/menu.repository';
import { MenuNotFoundException } from '../../domain/exceptions/menu-not-found.exception';
import {
  MenuCategoryRepository,
  MENU_CATEGORY_REPOSITORY,
} from '../../domain/repositories/menu-category.repository';
import {
  MenuItemRepository,
  MENU_ITEM_REPOSITORY,
} from '../../domain/repositories/menu-item.repository';
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
import { MenuItem } from '../../domain/entities/menu-item.entity';
import { MenuItemAddOn } from '../../domain/entities/menu-item-add-on.entity';
import { MenuItemAvailability } from '../../domain/entities/menu-item-availability.entity';
import { resolveMenuImageUrls } from '../services/resolve-menu-image-urls';
import { GetMenuCommand } from '../dto/menu.commands';
import {
  MenuTreeResult,
  MenuItemTreeResult,
  MenuCategoryTreeResult,
} from '../dto/menu-tree.result';

/**
 * Customer-facing public read (DOMAIN_MODEL.md "Get Menu") - full nested
 * tree for one Menu, defaulting to the Restaurant's `isDefault` Menu when
 * `menuId` is omitted (ADR-032). Unauthenticated - uses
 * `existsPubliclyById`, never the tenant-scoped `findById`. Options/Add-ons
 * with `active = false` are excluded from the public tree (still visible to
 * Owner/Admin/Employee via the management read); Items with any
 * `availabilityMode` are always included (an "Unavailable"/"Scheduled" item
 * is customer-visible with its mode shown, not hidden).
 */
@Injectable()
export class GetMenuUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
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

  async execute(command: GetMenuCommand): Promise<MenuTreeResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const exists = await this.restaurantRepository.existsPubliclyById(restaurantId);
    if (!exists) {
      throw new RestaurantNotFoundException();
    }

    const menu = command.menuId
      ? await this.menuRepository.findByIdAndRestaurantId(
          MenuId.create(command.menuId),
          restaurantId,
        )
      : await this.menuRepository.findDefaultByRestaurantId(restaurantId);
    if (menu === null || !menu.active) {
      throw new MenuNotFoundException();
    }

    const categories = await this.categoryRepository.findManyByMenuId(menu.menuId);
    const itemsByCategory = await Promise.all(
      categories.map((category) =>
        this.itemRepository.findManyByCategoryId(category.menuCategoryId),
      ),
    );
    const allItems = itemsByCategory.flat();

    const [optionGroupsByItem, addOnsByItem, availabilityByItem] = await Promise.all([
      Promise.all(
        allItems.map((item) => this.optionGroupRepository.findManyByMenuItemId(item.menuItemId)),
      ),
      Promise.all(
        allItems.map((item) => this.addOnRepository.findManyByMenuItemId(item.menuItemId)),
      ),
      Promise.all(
        allItems.map((item) => this.availabilityRepository.findManyByMenuItemId(item.menuItemId)),
      ),
    ]);
    const allOptionGroups = optionGroupsByItem.flat();
    const optionsByGroup = await Promise.all(
      allOptionGroups.map((group) =>
        this.optionRepository.findManyByOptionGroupId(group.optionGroupId),
      ),
    );

    const itemIndexById = new Map(allItems.map((item, index) => [item.menuItemId.value, index]));
    const optionGroupIndexById = new Map(
      allOptionGroups.map((group, index) => [group.optionGroupId.value, index]),
    );

    const imageFileIds = [
      ...categories.map((c) => c.imageFileId?.value ?? null),
      ...allItems.map((i) => i.imageFileId?.value ?? null),
    ];
    const imageUrlByFileId = await resolveMenuImageUrls(
      imageFileIds,
      this.fileRepository,
      this.storagePort,
    );

    const categoryResults: MenuCategoryTreeResult[] = categories.map((category, categoryIndex) => {
      const items = itemsByCategory[categoryIndex];
      const itemResults: MenuItemTreeResult[] = items.map((item) => {
        // Non-null: every entry in `allItems` was used to build these maps above.
        const itemIndex = itemIndexById.get(item.menuItemId.value) as number;
        const optionGroups = optionGroupsByItem[itemIndex];
        const addOns = addOnsByItem[itemIndex].filter((a) => a.active);
        const availability = availabilityByItem[itemIndex];

        const optionGroupResults = optionGroups.map((group) => {
          const groupIndex = optionGroupIndexById.get(group.optionGroupId.value) as number;
          const options = optionsByGroup[groupIndex];
          return {
            id: group.optionGroupId.value,
            name: group.name,
            required: group.required,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections,
            displayOrder: group.displayOrder,
            options: options
              .filter((o) => o.active)
              .map((o) => ({
                id: o.menuItemOptionId.value,
                name: o.name,
                priceModifier: o.priceModifier,
                active: o.active,
                displayOrder: o.displayOrder,
              })),
          };
        });

        return toItemTreeResult(item, optionGroupResults, addOns, availability, imageUrlByFileId);
      });

      return {
        id: category.menuCategoryId.value,
        menuId: category.menuId.value,
        name: category.name,
        description: category.description,
        imageUrl: category.imageFileId
          ? (imageUrlByFileId.get(category.imageFileId.value) ?? null)
          : null,
        displayOrder: category.displayOrder,
        items: itemResults,
      };
    });

    return {
      id: menu.menuId.value,
      restaurantId: menu.restaurantId.value,
      name: menu.name,
      active: menu.active,
      isDefault: menu.isDefault,
      displayOrder: menu.displayOrder,
      categories: categoryResults,
    };
  }
}

function toItemTreeResult(
  item: MenuItem,
  optionGroups: MenuItemTreeResult['optionGroups'],
  addOns: MenuItemAddOn[],
  availability: MenuItemAvailability[],
  imageUrlByFileId: Map<string, string>,
): MenuItemTreeResult {
  return {
    id: item.menuItemId.value,
    categoryId: item.categoryId.value,
    name: item.name,
    description: item.description,
    price: item.price,
    currency: item.currency,
    imageUrl: item.imageFileId ? (imageUrlByFileId.get(item.imageFileId.value) ?? null) : null,
    availabilityMode: item.availabilityMode,
    isFeatured: item.isFeatured,
    preparationTimeMinutes: item.preparationTimeMinutes,
    spicyLevel: item.spicyLevel,
    calories: item.calories,
    allergens: item.allergens,
    dietaryLabels: item.dietaryLabels,
    displayOrder: item.displayOrder,
    optionGroups,
    addOns: addOns.map((a) => ({
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
