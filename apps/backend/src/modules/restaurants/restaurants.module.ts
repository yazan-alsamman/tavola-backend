import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { CreateRestaurantUseCase } from './application/use-cases/create-restaurant.use-case';
import { GetRestaurantUseCase } from './application/use-cases/get-restaurant.use-case';
import { ListRestaurantsUseCase } from './application/use-cases/list-restaurants.use-case';
import { UpdateRestaurantUseCase } from './application/use-cases/update-restaurant.use-case';
import { DeleteRestaurantUseCase } from './application/use-cases/delete-restaurant.use-case';
import { GetRestaurantSettingsUseCase } from './application/use-cases/get-restaurant-settings.use-case';
import { UpdateRestaurantSettingsUseCase } from './application/use-cases/update-restaurant-settings.use-case';
import { GetWorkingHoursUseCase } from './application/use-cases/get-working-hours.use-case';
import { UpdateWorkingHoursUseCase } from './application/use-cases/update-working-hours.use-case';
import { RESTAURANT_REPOSITORY } from './domain/repositories/restaurant.repository';
import { RESTAURANT_SETTINGS_REPOSITORY } from './domain/repositories/restaurant-settings.repository';
import { WORKING_HOURS_REPOSITORY } from './domain/repositories/working-hours.repository';
import { PrismaRestaurantRepository } from './infrastructure/persistence/prisma-restaurant.repository';
import { PrismaRestaurantSettingsRepository } from './infrastructure/persistence/prisma-restaurant-settings.repository';
import { PrismaWorkingHoursRepository } from './infrastructure/persistence/prisma-working-hours.repository';
import { RestaurantsController } from './presentation/controllers/restaurants.controller';

/**
 * Phase 4.1 (Restaurant CRUD) + Phase 4.2 (Restaurant Settings) + Phase 4.3
 * (Working Hours, restaurant-level only - see `WorkingHours` model's own
 * schema comment). Depends on
 * `AuthenticationModule` for `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER` (the
 * same shared tokens every other module reuses, e.g. `UsersModule`) and
 * `JwtAuthGuard`/`SessionVersionGuard`; depends on `AuthorizationModule` for
 * `OrganizationMemberGuard` - the organization-administrative counterpart to
 * `PermissionsGuard`, built this phase since `Restaurant` is the first
 * tenant-owned resource requiring it. `PrismaModule` supplies `PrismaContext`,
 * the tenant-scoped Prisma client `PrismaRestaurantRepository` uses -
 * `Restaurant` is already registered in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md), so no extension change was
 * needed for this phase. `AUDIT_LOG_WRITER` (used by
 * `UpdateRestaurantSettingsUseCase`) is not listed here - `AuditModule` is
 * `@Global()`.
 */
@Module({
  imports: [AuthenticationModule, AuthorizationModule, PrismaModule],
  controllers: [RestaurantsController],
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
    PrismaRestaurantRepository,
    PrismaRestaurantSettingsRepository,
    PrismaWorkingHoursRepository,
    { provide: RESTAURANT_REPOSITORY, useExisting: PrismaRestaurantRepository },
    { provide: RESTAURANT_SETTINGS_REPOSITORY, useExisting: PrismaRestaurantSettingsRepository },
    { provide: WORKING_HOURS_REPOSITORY, useExisting: PrismaWorkingHoursRepository },
  ],
})
export class RestaurantsModule {}
