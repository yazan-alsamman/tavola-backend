import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StorageConfig } from '@config/storage.config';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { FilesModule } from '@modules/files/files.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { CreateRestaurantUseCase } from './application/use-cases/create-restaurant.use-case';
import { GetRestaurantUseCase } from './application/use-cases/get-restaurant.use-case';
import { ListRestaurantsUseCase } from './application/use-cases/list-restaurants.use-case';
import { UpdateRestaurantUseCase } from './application/use-cases/update-restaurant.use-case';
import { DeleteRestaurantUseCase } from './application/use-cases/delete-restaurant.use-case';
import { GetRestaurantSettingsUseCase } from './application/use-cases/get-restaurant-settings.use-case';
import { UpdateRestaurantSettingsUseCase } from './application/use-cases/update-restaurant-settings.use-case';
import { GetWorkingHoursUseCase } from './application/use-cases/get-working-hours.use-case';
import { UpdateWorkingHoursUseCase } from './application/use-cases/update-working-hours.use-case';
import { AddRestaurantGalleryImageUseCase } from './application/use-cases/add-restaurant-gallery-image.use-case';
import { ListRestaurantGalleryUseCase } from './application/use-cases/list-restaurant-gallery.use-case';
import { RemoveRestaurantGalleryImageUseCase } from './application/use-cases/remove-restaurant-gallery-image.use-case';
import { ListCuisineCategoriesUseCase } from './application/use-cases/list-cuisine-categories.use-case';
import { ListOccasionCategoriesUseCase } from './application/use-cases/list-occasion-categories.use-case';
import { GetRestaurantCuisineCategoriesUseCase } from './application/use-cases/get-restaurant-cuisine-categories.use-case';
import { SetRestaurantCuisineCategoriesUseCase } from './application/use-cases/set-restaurant-cuisine-categories.use-case';
import { GetRestaurantOccasionCategoriesUseCase } from './application/use-cases/get-restaurant-occasion-categories.use-case';
import { SetRestaurantOccasionCategoriesUseCase } from './application/use-cases/set-restaurant-occasion-categories.use-case';
import { RESTAURANT_REPOSITORY } from './domain/repositories/restaurant.repository';
import { RESTAURANT_SETTINGS_REPOSITORY } from './domain/repositories/restaurant-settings.repository';
import { WORKING_HOURS_REPOSITORY } from './domain/repositories/working-hours.repository';
import { RESTAURANT_GALLERY_REPOSITORY } from './domain/repositories/restaurant-gallery.repository';
import { CUISINE_CATEGORY_REPOSITORY } from './domain/repositories/cuisine-category.repository';
import { OCCASION_CATEGORY_REPOSITORY } from './domain/repositories/occasion-category.repository';
import { RESTAURANT_CUISINE_CATEGORY_REPOSITORY } from './domain/repositories/restaurant-cuisine-category.repository';
import { RESTAURANT_OCCASION_CATEGORY_REPOSITORY } from './domain/repositories/restaurant-occasion-category.repository';
import { RESTAURANT_USAGE_REPOSITORY } from './domain/repositories/restaurant-usage.repository';
import { PrismaRestaurantRepository } from './infrastructure/persistence/prisma-restaurant.repository';
import { PrismaRestaurantSettingsRepository } from './infrastructure/persistence/prisma-restaurant-settings.repository';
import { PrismaWorkingHoursRepository } from './infrastructure/persistence/prisma-working-hours.repository';
import { PrismaRestaurantGalleryRepository } from './infrastructure/persistence/prisma-restaurant-gallery.repository';
import { PrismaCuisineCategoryRepository } from './infrastructure/persistence/prisma-cuisine-category.repository';
import { PrismaOccasionCategoryRepository } from './infrastructure/persistence/prisma-occasion-category.repository';
import { PrismaRestaurantCuisineCategoryRepository } from './infrastructure/persistence/prisma-restaurant-cuisine-category.repository';
import { PrismaRestaurantOccasionCategoryRepository } from './infrastructure/persistence/prisma-restaurant-occasion-category.repository';
import { PrismaRestaurantUsageRepository } from './infrastructure/persistence/prisma-restaurant-usage.repository';
import { GALLERY_BUCKET } from './application/tokens/restaurants.tokens';
import { RestaurantsController } from './presentation/controllers/restaurants.controller';
import { TaxonomyCategoriesController } from './presentation/controllers/taxonomy-categories.controller';

/**
 * Phase 4.1 (Restaurant CRUD) + Phase 4.2 (Restaurant Settings) + Phase 4.3
 * (Working Hours, restaurant-level only - see `WorkingHours` model's own
 * schema comment) + Phase 4.4 (Gallery, restaurant-level only - see
 * `RestaurantGallery` model's own schema comment) + Phase 4.5 (Cuisine &
 * Occasion Taxonomy Assignment, ADR-018 - `CuisineCategory`/
 * `OccasionCategory` are platform-managed reference data seeded via
 * `prisma/seed.ts`; `TaxonomyCategoriesController` exposes their public,
 * unauthenticated list endpoints, while `RestaurantsController`'s
 * `:id/cuisine-categories` and `:id/occasion-categories` routes reuse
 * `OrganizationMemberGuard`/`@RequireOrgRole()` unchanged for the per-
 * restaurant assignment, identical to Settings/Working Hours/Gallery).
 * Depends on
 * `AuthenticationModule` for `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER` (the
 * same shared tokens every other module reuses, e.g. `UsersModule`) and
 * `JwtAuthGuard`/`SessionVersionGuard`. Depends on `SubscriptionsModule`
 * (Phase 12, ADR-027) for `SUBSCRIPTION_REPOSITORY`/
 * `SUBSCRIPTION_PLAN_REPOSITORY`/`SUBSCRIPTION_USAGE_REPOSITORY`, which
 * `CreateRestaurantUseCase`/`DeleteRestaurantUseCase` need to enforce
 * `maxRestaurants` and keep `SubscriptionUsage.restaurantCount` in sync.
 * Both this import and the `AuthenticationModule` import above are wrapped
 * in `forwardRef`: `SubscriptionsModule` in turn imports this module (for
 * `RESTAURANT_REPOSITORY`/`RESTAURANT_USAGE_REPOSITORY`) and imports
 * `AuthenticationModule` (for `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER`/
 * `UNIT_OF_WORK`/`TENANT_CONTEXT_PORT`), while `AuthenticationModule` itself
 * imports `SubscriptionsModule` (for `SUBSCRIPTION_REPOSITORY`/
 * `SUBSCRIPTION_USAGE_REPOSITORY`, used by `ProvisionRestaurantOwnerUseCase`)
 * - a genuine three-module cycle spanning two edges from this module
 * (`RestaurantsModule` ↔ `AuthenticationModule` ↔ `SubscriptionsModule` ↔
 * `RestaurantsModule`). Without `forwardRef` on both of this module's
 * cycle-participating imports, the circular `require`/`import` chain
 * resolves the referenced module to `undefined` at this module's own
 * decoration time whenever that module hasn't finished loading yet at that
 * point in the chain - this is not merely a Nest DI-graph concern
 * (`forwardRef` closing only one edge is not sufficient once a third module
 * sits in the same cycle); depends on `AuthorizationModule` for
 * `OrganizationMemberGuard` - the organization-administrative counterpart to
 * `PermissionsGuard`, built this phase since `Restaurant` is the first
 * tenant-owned resource requiring it. `PrismaModule` supplies `PrismaContext`,
 * the tenant-scoped Prisma client `PrismaRestaurantRepository` uses -
 * `Restaurant` is already registered in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md), so no extension change was
 * needed for this phase. `AUDIT_LOG_WRITER` (used by
 * `UpdateRestaurantSettingsUseCase`) is not listed here - `AuditModule` is
 * `@Global()`. `FilesModule` supplies the Files aggregate's persistence +
 * storage ports (`FILE_REPOSITORY`, `STORAGE_PORT`) that Gallery reuses
 * completely (Phase 4.4 approved architecture decision) rather than building
 * a second upload subsystem - identical to `UsersModule`'s avatar upload
 * reuse. `GALLERY_BUCKET` resolves to the same existing public bucket
 * `AVATAR_BUCKET` uses - no new bucket, no new storage strategy.
 */
@Module({
  imports: [
    forwardRef(() => AuthenticationModule),
    forwardRef(() => SubscriptionsModule),
    AuthorizationModule,
    FilesModule,
    PrismaModule,
    ConfigModule,
  ],
  controllers: [RestaurantsController, TaxonomyCategoriesController],
  providers: [
    CreateRestaurantUseCase,
    GetRestaurantUseCase,
    ListRestaurantsUseCase,
    UpdateRestaurantUseCase,
    DeleteRestaurantUseCase,
    GetRestaurantSettingsUseCase,
    UpdateRestaurantSettingsUseCase,
    GetWorkingHoursUseCase,
    UpdateWorkingHoursUseCase,
    AddRestaurantGalleryImageUseCase,
    ListRestaurantGalleryUseCase,
    RemoveRestaurantGalleryImageUseCase,
    ListCuisineCategoriesUseCase,
    ListOccasionCategoriesUseCase,
    GetRestaurantCuisineCategoriesUseCase,
    SetRestaurantCuisineCategoriesUseCase,
    GetRestaurantOccasionCategoriesUseCase,
    SetRestaurantOccasionCategoriesUseCase,
    PrismaRestaurantRepository,
    PrismaRestaurantSettingsRepository,
    PrismaWorkingHoursRepository,
    PrismaRestaurantGalleryRepository,
    PrismaCuisineCategoryRepository,
    PrismaOccasionCategoryRepository,
    PrismaRestaurantCuisineCategoryRepository,
    PrismaRestaurantOccasionCategoryRepository,
    PrismaRestaurantUsageRepository,
    { provide: RESTAURANT_REPOSITORY, useExisting: PrismaRestaurantRepository },
    { provide: RESTAURANT_USAGE_REPOSITORY, useExisting: PrismaRestaurantUsageRepository },
    { provide: RESTAURANT_SETTINGS_REPOSITORY, useExisting: PrismaRestaurantSettingsRepository },
    { provide: WORKING_HOURS_REPOSITORY, useExisting: PrismaWorkingHoursRepository },
    { provide: RESTAURANT_GALLERY_REPOSITORY, useExisting: PrismaRestaurantGalleryRepository },
    { provide: CUISINE_CATEGORY_REPOSITORY, useExisting: PrismaCuisineCategoryRepository },
    { provide: OCCASION_CATEGORY_REPOSITORY, useExisting: PrismaOccasionCategoryRepository },
    {
      provide: RESTAURANT_CUISINE_CATEGORY_REPOSITORY,
      useExisting: PrismaRestaurantCuisineCategoryRepository,
    },
    {
      provide: RESTAURANT_OCCASION_CATEGORY_REPOSITORY,
      useExisting: PrismaRestaurantOccasionCategoryRepository,
    },
    {
      provide: GALLERY_BUCKET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): string =>
        configService.getOrThrow<StorageConfig>('storage').publicBucket,
    },
  ],
  // RESTAURANT_REPOSITORY is exported for BranchesModule (Phase 5.1): Branch
  // carries no direct organizationId column (TENANCY.md), so its use cases
  // resolve the parent Restaurant through this already-tenant-scoped
  // repository first, exactly like WorkingHours/RestaurantSettings do within
  // this same module - just across a module boundary since Branch is its own
  // top-level feature module. RESTAURANT_SETTINGS_REPOSITORY is exported for
  // ReservationsModule (Phase 7.1): Search Availability and Create
  // Reservation both need `defaultReservationDurationMinutes`/
  // `reservationIntervalMinutes` to derive `reservationEndTime`/the advisory
  // lock's time-slot bucket - `RestaurantSettings` is not tenant-enforced
  // (transitively tenant-owned only), so this is a safe passthrough for a
  // customer-facing (no-organizationId) actor, unlike `RESTAURANT_REPOSITORY`
  // itself.
  // RESTAURANT_USAGE_REPOSITORY is exported for SubscriptionsModule (Phase
  // 12, ADR-027): RestaurantUsage is a Restaurant Aggregate child entity
  // (transitively tenant-owned via restaurantId, not a
  // DIRECT_TENANT_OWNED_MODEL), so Subscription's downgrade-validation and
  // usage-read use cases resolve it through this already-tenant-scoped
  // module boundary, exactly like RESTAURANT_SETTINGS_REPOSITORY is
  // exported for ReservationsModule above.
  exports: [RESTAURANT_REPOSITORY, RESTAURANT_SETTINGS_REPOSITORY, RESTAURANT_USAGE_REPOSITORY],
})
export class RestaurantsModule {}
