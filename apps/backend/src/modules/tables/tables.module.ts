import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { CreateFloorPlanUseCase } from './application/use-cases/create-floor-plan.use-case';
import { ListFloorPlansUseCase } from './application/use-cases/list-floor-plans.use-case';
import { ActivateFloorPlanUseCase } from './application/use-cases/activate-floor-plan.use-case';
import { CreateFloorPlanAreaUseCase } from './application/use-cases/create-floor-plan-area.use-case';
import { ListFloorPlanAreasUseCase } from './application/use-cases/list-floor-plan-areas.use-case';
import { GetFloorPlanAreaUseCase } from './application/use-cases/get-floor-plan-area.use-case';
import { UpdateFloorPlanAreaUseCase } from './application/use-cases/update-floor-plan-area.use-case';
import { DeleteFloorPlanAreaUseCase } from './application/use-cases/delete-floor-plan-area.use-case';
import { CreateTableUseCase } from './application/use-cases/create-table.use-case';
import { UpdateTableUseCase } from './application/use-cases/update-table.use-case';
import { DeleteTableUseCase } from './application/use-cases/delete-table.use-case';
import { MoveTableUseCase } from './application/use-cases/move-table.use-case';
import { ChangeTableStatusUseCase } from './application/use-cases/change-table-status.use-case';
import { MergeTablesUseCase } from './application/use-cases/merge-tables.use-case';
import { SplitTablesUseCase } from './application/use-cases/split-tables.use-case';
import { GetTableUseCase } from './application/use-cases/get-table.use-case';
import { ListTablesByBranchUseCase } from './application/use-cases/list-tables-by-branch.use-case';
import { ListTablesByFloorPlanUseCase } from './application/use-cases/list-tables-by-floor-plan.use-case';
import { FLOOR_PLAN_REPOSITORY } from './domain/repositories/floor-plan.repository';
import { FLOOR_PLAN_AREA_REPOSITORY } from './domain/repositories/floor-plan-area.repository';
import { TABLE_REPOSITORY } from './domain/repositories/table.repository';
import { PrismaFloorPlanRepository } from './infrastructure/persistence/prisma-floor-plan.repository';
import { PrismaFloorPlanAreaRepository } from './infrastructure/persistence/prisma-floor-plan-area.repository';
import { PrismaTableRepository } from './infrastructure/persistence/prisma-table.repository';
import { FloorPlansController } from './presentation/controllers/floor-plans.controller';
import { FloorPlanAreasController } from './presentation/controllers/floor-plan-areas.controller';
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
 *
 * ADR-040 adds `FloorPlanArea` (concurrent dining areas inside one FloorPlan)
 * to this module rather than a new one - it is a child of `FloorPlan`, which
 * this module already owns, and every one of its use cases walks the same
 * Restaurant -> Branch -> FloorPlan tenant chain the existing ones do.
 * `FLOOR_PLAN_AREA_REPOSITORY` is exported alongside the other two so the
 * Discovery module's public floor-plan projection can read areas through the
 * same port instead of reaching into Prisma on its own.
 *
 * Phase 6 (Merge/Split Tables, ADR-026) adds `MergeTablesUseCase`/
 * `SplitTablesUseCase`, which need `RESERVATION_REPOSITORY`'s
 * `hasBlockingReservation` (decision #6) - hence the new `forwardRef(() =>
 * ReservationsModule)` import. `forwardRef` is required on both sides
 * (mirroring the pre-existing `BranchesModule` edge above): `ReservationsModule`
 * already imports `TablesModule` for `TABLE_REPOSITORY`, so this is a
 * genuine circular dependency between the two feature modules, not a new
 * architectural pattern.
 */
@Module({
  imports: [
    // Phase 19.8 (Owner Invite, ADR-036) correction: forwardRef - see
    // branches.module.ts's matching fix for the exact boot-time symptom.
    forwardRef(() => AuthenticationModule),
    AuthorizationModule,
    RestaurantsModule,
    forwardRef(() => BranchesModule),
    forwardRef(() => ReservationsModule),
    PrismaModule,
  ],
  controllers: [FloorPlansController, FloorPlanAreasController, TablesController, TableController],
  providers: [
    CreateFloorPlanUseCase,
    ListFloorPlansUseCase,
    ActivateFloorPlanUseCase,
    CreateFloorPlanAreaUseCase,
    ListFloorPlanAreasUseCase,
    GetFloorPlanAreaUseCase,
    UpdateFloorPlanAreaUseCase,
    DeleteFloorPlanAreaUseCase,
    CreateTableUseCase,
    UpdateTableUseCase,
    DeleteTableUseCase,
    MoveTableUseCase,
    ChangeTableStatusUseCase,
    MergeTablesUseCase,
    SplitTablesUseCase,
    GetTableUseCase,
    ListTablesByBranchUseCase,
    ListTablesByFloorPlanUseCase,
    PrismaFloorPlanRepository,
    PrismaFloorPlanAreaRepository,
    PrismaTableRepository,
    { provide: FLOOR_PLAN_REPOSITORY, useExisting: PrismaFloorPlanRepository },
    { provide: FLOOR_PLAN_AREA_REPOSITORY, useExisting: PrismaFloorPlanAreaRepository },
    { provide: TABLE_REPOSITORY, useExisting: PrismaTableRepository },
  ],
  // Exported for BranchesModule's DeleteBranchUseCase cascade (TASKS.md
  // Phase 6.1 decisions #3/#6) - both must be soft-deleted alongside the
  // Branch inside one transaction.
  exports: [FLOOR_PLAN_REPOSITORY, FLOOR_PLAN_AREA_REPOSITORY, TABLE_REPOSITORY],
})
export class TablesModule {}
