import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { CreateFloorPlanUseCase } from './application/use-cases/create-floor-plan.use-case';
import { ListFloorPlansUseCase } from './application/use-cases/list-floor-plans.use-case';
import { ActivateFloorPlanUseCase } from './application/use-cases/activate-floor-plan.use-case';
import { CreateTableUseCase } from './application/use-cases/create-table.use-case';
import { UpdateTableUseCase } from './application/use-cases/update-table.use-case';
import { DeleteTableUseCase } from './application/use-cases/delete-table.use-case';
import { MoveTableUseCase } from './application/use-cases/move-table.use-case';
import { ChangeTableStatusUseCase } from './application/use-cases/change-table-status.use-case';
import { GetTableUseCase } from './application/use-cases/get-table.use-case';
import { ListTablesByBranchUseCase } from './application/use-cases/list-tables-by-branch.use-case';
import { ListTablesByFloorPlanUseCase } from './application/use-cases/list-tables-by-floor-plan.use-case';
import { FLOOR_PLAN_REPOSITORY } from './domain/repositories/floor-plan.repository';
import { TABLE_REPOSITORY } from './domain/repositories/table.repository';
import { PrismaFloorPlanRepository } from './infrastructure/persistence/prisma-floor-plan.repository';
import { PrismaTableRepository } from './infrastructure/persistence/prisma-table.repository';
import { FloorPlansController } from './presentation/controllers/floor-plans.controller';
import { TablesController } from './presentation/controllers/tables.controller';
import { TableController } from './presentation/controllers/table.controller';

/**
 * Phase 6.1 - Table Module: `TablesModule` owns both `Table` and `FloorPlan`
 * (TASKS.md Phase 6.1 decision #1) - their use cases, controllers,
 * repositories, and DTOs all live here, not inside `BranchesModule`, even
 * though Branch is their DDD Aggregate Root (DOMAIN_MODEL.md). Depends on
 * `AuthenticationModule` for `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER` and
 * `JwtAuthGuard`/`SessionVersionGuard`; depends on `AuthorizationModule` for
 * `OrganizationMemberGuard` - identical organization-administrative
 * authorization stack to `BranchesController`. Depends on `RestaurantsModule`
 * for `RESTAURANT_REPOSITORY` and `BranchesModule` for `BRANCH_REPOSITORY`
 * (the same cross-module export pattern `BranchesModule` already uses for
 * `RestaurantRepository`) - neither `Table` nor `FloorPlan` carries a direct
 * `organizationId` column (TENANCY.md), so every use case resolves the
 * parent Restaurant then Branch through their already-tenant-scoped
 * repositories first. `forwardRef` is required on both sides of the
 * `BranchesModule` <-> `TablesModule` edge: `BranchesModule`'s own
 * `DeleteBranchUseCase` must cascade into `TABLE_REPOSITORY`/
 * `FLOOR_PLAN_REPOSITORY` (TASKS.md Phase 6.1 decisions #3/#6), while this
 * module needs `BRANCH_REPOSITORY` back - a genuine circular dependency
 * between the two feature modules, resolved with Nest's standard
 * `forwardRef` mechanism rather than restructuring either module.
 * `PrismaModule` supplies `PrismaContext`; neither model is added to
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` - see
 * `PrismaFloorPlanRepository`/`PrismaTableRepository`'s own doc comments.
 * `AUDIT_LOG_WRITER` is not listed - `AuditModule` is `@Global()`.
 */
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    RestaurantsModule,
    forwardRef(() => BranchesModule),
    PrismaModule,
  ],
  controllers: [FloorPlansController, TablesController, TableController],
  providers: [
    CreateFloorPlanUseCase,
    ListFloorPlansUseCase,
    ActivateFloorPlanUseCase,
    CreateTableUseCase,
    UpdateTableUseCase,
    DeleteTableUseCase,
    MoveTableUseCase,
    ChangeTableStatusUseCase,
    GetTableUseCase,
    ListTablesByBranchUseCase,
    ListTablesByFloorPlanUseCase,
    PrismaFloorPlanRepository,
    PrismaTableRepository,
    { provide: FLOOR_PLAN_REPOSITORY, useExisting: PrismaFloorPlanRepository },
    { provide: TABLE_REPOSITORY, useExisting: PrismaTableRepository },
  ],
  // Exported for BranchesModule's DeleteBranchUseCase cascade (TASKS.md
  // Phase 6.1 decisions #3/#6) - both must be soft-deleted alongside the
  // Branch inside one transaction.
  exports: [FLOOR_PLAN_REPOSITORY, TABLE_REPOSITORY],
})
export class TablesModule {}
