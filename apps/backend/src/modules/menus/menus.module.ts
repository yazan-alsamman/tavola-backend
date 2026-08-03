import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StorageConfig } from '@config/storage.config';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { FilesModule } from '@modules/files/files.module';
import { MENU_REPOSITORY } from './domain/repositories/menu.repository';
import { MENU_CATEGORY_REPOSITORY } from './domain/repositories/menu-category.repository';
import { MENU_ITEM_REPOSITORY } from './domain/repositories/menu-item.repository';
import { MENU_ITEM_OPTION_GROUP_REPOSITORY } from './domain/repositories/menu-item-option-group.repository';
import { MENU_ITEM_OPTION_REPOSITORY } from './domain/repositories/menu-item-option.repository';
import { MENU_ITEM_ADD_ON_REPOSITORY } from './domain/repositories/menu-item-add-on.repository';
import { MENU_ITEM_AVAILABILITY_REPOSITORY } from './domain/repositories/menu-item-availability.repository';
import { PrismaMenuRepository } from './infrastructure/persistence/prisma-menu.repository';
import { PrismaMenuCategoryRepository } from './infrastructure/persistence/prisma-menu-category.repository';
import { PrismaMenuItemRepository } from './infrastructure/persistence/prisma-menu-item.repository';
import { PrismaMenuItemOptionGroupRepository } from './infrastructure/persistence/prisma-menu-item-option-group.repository';
import { PrismaMenuItemOptionRepository } from './infrastructure/persistence/prisma-menu-item-option.repository';
import { PrismaMenuItemAddOnRepository } from './infrastructure/persistence/prisma-menu-item-add-on.repository';
import { PrismaMenuItemAvailabilityRepository } from './infrastructure/persistence/prisma-menu-item-availability.repository';
import { MENU_IMAGE_BUCKET } from './application/tokens/menus.tokens';
import { CreateMenuUseCase } from './application/use-cases/create-menu.use-case';
import { UpdateMenuUseCase } from './application/use-cases/update-menu.use-case';
import { ActivateMenuUseCase } from './application/use-cases/activate-menu.use-case';
import { DeactivateMenuUseCase } from './application/use-cases/deactivate-menu.use-case';
import { SetDefaultMenuUseCase } from './application/use-cases/set-default-menu.use-case';
import { DeleteMenuUseCase } from './application/use-cases/delete-menu.use-case';
import { ListRestaurantMenusUseCase } from './application/use-cases/list-restaurant-menus.use-case';
import { ListRestaurantIdsWithMenuUseCase } from './application/use-cases/list-restaurant-ids-with-menu.use-case';
import { GetMenuUseCase } from './application/use-cases/get-menu.use-case';
import { CreateMenuCategoryUseCase } from './application/use-cases/create-menu-category.use-case';
import { UpdateMenuCategoryUseCase } from './application/use-cases/update-menu-category.use-case';
import { DeleteMenuCategoryUseCase } from './application/use-cases/delete-menu-category.use-case';
import { ReorderMenuCategoriesUseCase } from './application/use-cases/reorder-menu-categories.use-case';
import { UploadMenuCategoryImageUseCase } from './application/use-cases/upload-menu-category-image.use-case';
import { RemoveMenuCategoryImageUseCase } from './application/use-cases/remove-menu-category-image.use-case';
import { GetMenuCategoryUseCase } from './application/use-cases/get-menu-category.use-case';
import { CreateMenuItemUseCase } from './application/use-cases/create-menu-item.use-case';
import { UpdateMenuItemUseCase } from './application/use-cases/update-menu-item.use-case';
import { DeleteMenuItemUseCase } from './application/use-cases/delete-menu-item.use-case';
import { ReorderMenuItemsUseCase } from './application/use-cases/reorder-menu-items.use-case';
import { FeatureMenuItemUseCase } from './application/use-cases/feature-menu-item.use-case';
import { UnfeatureMenuItemUseCase } from './application/use-cases/unfeature-menu-item.use-case';
import { ReplaceMenuItemAvailabilityWindowsUseCase } from './application/use-cases/replace-menu-item-availability-windows.use-case';
import { UploadMenuItemImageUseCase } from './application/use-cases/upload-menu-item-image.use-case';
import { RemoveMenuItemImageUseCase } from './application/use-cases/remove-menu-item-image.use-case';
import { GetMenuItemUseCase } from './application/use-cases/get-menu-item.use-case';
import { CreateMenuItemOptionGroupUseCase } from './application/use-cases/create-menu-item-option-group.use-case';
import { UpdateMenuItemOptionGroupUseCase } from './application/use-cases/update-menu-item-option-group.use-case';
import { DeleteMenuItemOptionGroupUseCase } from './application/use-cases/delete-menu-item-option-group.use-case';
import { CreateMenuItemOptionUseCase } from './application/use-cases/create-menu-item-option.use-case';
import { UpdateMenuItemOptionUseCase } from './application/use-cases/update-menu-item-option.use-case';
import { DeleteMenuItemOptionUseCase } from './application/use-cases/delete-menu-item-option.use-case';
import { CreateMenuItemAddOnUseCase } from './application/use-cases/create-menu-item-add-on.use-case';
import { UpdateMenuItemAddOnUseCase } from './application/use-cases/update-menu-item-add-on.use-case';
import { DeleteMenuItemAddOnUseCase } from './application/use-cases/delete-menu-item-add-on.use-case';
import { MenusController } from './presentation/controllers/menus.controller';
import { MenuCategoriesController } from './presentation/controllers/menu-categories.controller';
import { MenuItemsController } from './presentation/controllers/menu-items.controller';
import { MenuItemOptionGroupsController } from './presentation/controllers/menu-item-option-groups.controller';
import { MenuItemAddOnsController } from './presentation/controllers/menu-item-add-ons.controller';

/**
 * Phase 18 (Menu Management, architecture frozen 2026-08-02, ADR-031;
 * ownership/availability/isFeatured corrected 2026-08-03, ADR-032;
 * implemented 2026-08-03). Depends on `RestaurantsModule` for
 * `RESTAURANT_REPOSITORY` (tenant isolation gate - every one of the seven
 * Menu-family models is transitively tenant-owned, TENANCY.md, so every use
 * case resolves the parent Restaurant first, exactly like `OffersModule`/
 * `ReviewsModule`) and `FilesModule` for `FILE_REPOSITORY`/`STORAGE_PORT`
 * (Category/Item image upload, ADR-031 decision #5). `MENU_IMAGE_BUCKET`
 * reuses the same public bucket as `RestaurantsModule`'s `GALLERY_BUCKET`
 * factory - no new bucket. `EVENT_PUBLISHER` (`RealtimeModule`, `@Global()`)
 * and `AUDIT_LOG_WRITER` (`AuditModule`, `@Global()`) need no explicit
 * import.
 */
@Module({
  imports: [ConfigModule, AuthenticationModule, RestaurantsModule, FilesModule],
  controllers: [
    MenusController,
    MenuCategoriesController,
    MenuItemsController,
    MenuItemOptionGroupsController,
    MenuItemAddOnsController,
  ],
  providers: [
    PrismaMenuRepository,
    { provide: MENU_REPOSITORY, useExisting: PrismaMenuRepository },
    PrismaMenuCategoryRepository,
    { provide: MENU_CATEGORY_REPOSITORY, useExisting: PrismaMenuCategoryRepository },
    PrismaMenuItemRepository,
    { provide: MENU_ITEM_REPOSITORY, useExisting: PrismaMenuItemRepository },
    PrismaMenuItemOptionGroupRepository,
    {
      provide: MENU_ITEM_OPTION_GROUP_REPOSITORY,
      useExisting: PrismaMenuItemOptionGroupRepository,
    },
    PrismaMenuItemOptionRepository,
    { provide: MENU_ITEM_OPTION_REPOSITORY, useExisting: PrismaMenuItemOptionRepository },
    PrismaMenuItemAddOnRepository,
    { provide: MENU_ITEM_ADD_ON_REPOSITORY, useExisting: PrismaMenuItemAddOnRepository },
    PrismaMenuItemAvailabilityRepository,
    {
      provide: MENU_ITEM_AVAILABILITY_REPOSITORY,
      useExisting: PrismaMenuItemAvailabilityRepository,
    },
    {
      provide: MENU_IMAGE_BUCKET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): string =>
        configService.getOrThrow<StorageConfig>('storage').publicBucket,
    },
    CreateMenuUseCase,
    UpdateMenuUseCase,
    ActivateMenuUseCase,
    DeactivateMenuUseCase,
    SetDefaultMenuUseCase,
    DeleteMenuUseCase,
    ListRestaurantMenusUseCase,
    ListRestaurantIdsWithMenuUseCase,
    GetMenuUseCase,
    CreateMenuCategoryUseCase,
    UpdateMenuCategoryUseCase,
    DeleteMenuCategoryUseCase,
    ReorderMenuCategoriesUseCase,
    UploadMenuCategoryImageUseCase,
    RemoveMenuCategoryImageUseCase,
    GetMenuCategoryUseCase,
    CreateMenuItemUseCase,
    UpdateMenuItemUseCase,
    DeleteMenuItemUseCase,
    ReorderMenuItemsUseCase,
    FeatureMenuItemUseCase,
    UnfeatureMenuItemUseCase,
    ReplaceMenuItemAvailabilityWindowsUseCase,
    UploadMenuItemImageUseCase,
    RemoveMenuItemImageUseCase,
    GetMenuItemUseCase,
    CreateMenuItemOptionGroupUseCase,
    UpdateMenuItemOptionGroupUseCase,
    DeleteMenuItemOptionGroupUseCase,
    CreateMenuItemOptionUseCase,
    UpdateMenuItemOptionUseCase,
    DeleteMenuItemOptionUseCase,
    CreateMenuItemAddOnUseCase,
    UpdateMenuItemAddOnUseCase,
    DeleteMenuItemAddOnUseCase,
  ],
  exports: [MENU_REPOSITORY, ListRestaurantIdsWithMenuUseCase],
})
export class MenusModule {}
