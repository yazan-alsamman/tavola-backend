import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { TablesModule } from '@modules/tables/tables.module';
import { CreateBranchUseCase } from './application/use-cases/create-branch.use-case';
import { GetBranchUseCase } from './application/use-cases/get-branch.use-case';
import { ListBranchesUseCase } from './application/use-cases/list-branches.use-case';
import { UpdateBranchUseCase } from './application/use-cases/update-branch.use-case';
import { DeleteBranchUseCase } from './application/use-cases/delete-branch.use-case';
import { GetBranchWorkingHoursUseCase } from './application/use-cases/get-branch-working-hours.use-case';
import { UpdateBranchWorkingHoursUseCase } from './application/use-cases/update-branch-working-hours.use-case';
import { ListBranchWorkingHoursByBranchIdsUseCase } from './application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { BRANCH_REPOSITORY } from './domain/repositories/branch.repository';
import { BRANCH_WORKING_HOURS_REPOSITORY } from './domain/repositories/branch-working-hours.repository';
import { PrismaBranchRepository } from './infrastructure/persistence/prisma-branch.repository';
import { PrismaBranchWorkingHoursRepository } from './infrastructure/persistence/prisma-branch-working-hours.repository';
import { BranchesController } from './presentation/controllers/branches.controller';

/**
 * Phase 5.1 (Branch CRUD) + Phase 5.2 (Working Schedule, branch-level
 * override - a separate `BranchWorkingHours` child entity from the
 * Restaurant-level `WorkingHours` default, see that entity's own Prisma
 * model comment). Maps/Address/Geo Coordinates remain separate, later Branch
 * sub-phases (see TASKS.md's Phase 5 checklist). Depends on
 * `AuthenticationModule` for `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER` and
 * `JwtAuthGuard`/`SessionVersionGuard`; depends on `AuthorizationModule` for
 * `OrganizationMemberGuard` - identical organization-administrative
 * authorization stack to `RestaurantsController` (Phase 4.1 precedent).
 * Depends on `RestaurantsModule` for `RESTAURANT_REPOSITORY`: neither `Branch`
 * nor `BranchWorkingHours` carries a direct `organizationId` column
 * (TENANCY.md), so every use case resolves the parent Restaurant through the
 * already-tenant-scoped `RestaurantRepository` first (and, for
 * `BranchWorkingHours`, the parent Branch as well) - the same relation-path
 * pattern `WorkingHours`/`RestaurantSettings` use, just across a module
 * boundary here since Branch is its own top-level feature module rather than
 * a Restaurant child feature. `PrismaModule` supplies `PrismaContext`; neither
 * model is added to `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` - see
 * `PrismaBranchRepository`/`PrismaBranchWorkingHoursRepository`'s own doc
 * comments. `AUDIT_LOG_WRITER` is not listed - `AuditModule` is `@Global()`.
 * `TablesModule` (via `forwardRef`, Phase 6.1) supplies `FLOOR_PLAN_REPOSITORY`/
 * `TABLE_REPOSITORY`: `DeleteBranchUseCase`'s cascade (TASKS.md Phase 6.1
 * decisions #3/#6) must soft-delete Tables and FloorPlans alongside the
 * Branch inside one transaction. `forwardRef` is required because
 * `TablesModule` itself imports `BranchesModule` for `BRANCH_REPOSITORY`
 * (TASKS.md Phase 6.1 decision #1) - a genuine circular dependency between
 * the two feature modules, resolved with Nest's standard mechanism rather
 * than restructuring either module.
 *
 * Phase 12 (Subscriptions, ADR-027 §8/D14, 2026-07-28): `SubscriptionsModule`
 * supplies `SUBSCRIPTION_REPOSITORY`/`SUBSCRIPTION_PLAN_REPOSITORY` so
 * `CreateBranchUseCase` can enforce `maxBranchesPerRestaurant` (per-Restaurant,
 * via `RESTAURANT_USAGE_REPOSITORY` already available through
 * `RestaurantsModule` above) and `DeleteBranchUseCase` can decrement it. Not
 * circular - `SubscriptionsModule` does not import `BranchesModule`.
 */
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    RestaurantsModule,
    SubscriptionsModule,
    forwardRef(() => TablesModule),
    PrismaModule,
  ],
  controllers: [BranchesController],
  providers: [
    CreateBranchUseCase,
    GetBranchUseCase,
    ListBranchesUseCase,
    UpdateBranchUseCase,
    DeleteBranchUseCase,
    GetBranchWorkingHoursUseCase,
    UpdateBranchWorkingHoursUseCase,
    ListBranchWorkingHoursByBranchIdsUseCase,
    PrismaBranchRepository,
    PrismaBranchWorkingHoursRepository,
    { provide: BRANCH_REPOSITORY, useExisting: PrismaBranchRepository },
    { provide: BRANCH_WORKING_HOURS_REPOSITORY, useExisting: PrismaBranchWorkingHoursRepository },
  ],
  // BRANCH_REPOSITORY is exported for TablesModule (Phase 6.1): Table/
  // FloorPlan carry no direct organizationId column (TENANCY.md), so their
  // use cases resolve the parent Branch through this already-tenant-scoped-
  // adjacent repository first, exactly like RestaurantsModule's own
  // RESTAURANT_REPOSITORY export for this module.
  // ListBranchWorkingHoursByBranchIdsUseCase is exported for DiscoveryModule
  // (Public Working Hours & Restaurant Phone Privacy): BranchWorkingHours is
  // not tenant-enforced (transitively tenant-owned only), so this is a safe
  // batched lookup for Discovery's customer-facing (no-organizationId)
  // callers, which have already resolved branch visibility themselves before
  // calling it - same passthrough-safe shape as this module's own
  // BRANCH_WORKING_HOURS_REPOSITORY.
  exports: [BRANCH_REPOSITORY, ListBranchWorkingHoursByBranchIdsUseCase],
})
export class BranchesModule {}
