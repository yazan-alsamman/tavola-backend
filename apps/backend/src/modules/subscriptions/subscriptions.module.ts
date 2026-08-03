import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { PlatformAdminModule } from '@modules/platform-admin/platform-admin.module';
import { SUBSCRIPTION_REPOSITORY } from './domain/repositories/subscription.repository';
import { SUBSCRIPTION_PLAN_REPOSITORY } from './domain/repositories/subscription-plan.repository';
import { SUBSCRIPTION_USAGE_REPOSITORY } from './domain/repositories/subscription-usage.repository';
import { SUBSCRIPTION_EXPIRATION_SCHEDULER } from './application/ports/subscription-expiration-scheduler.port';
import { AssignSubscriptionUseCase } from './application/use-cases/assign-subscription.use-case';
import { SuspendSubscriptionUseCase } from './application/use-cases/suspend-subscription.use-case';
import { ReactivateSubscriptionUseCase } from './application/use-cases/reactivate-subscription.use-case';
import { CancelSubscriptionUseCase } from './application/use-cases/cancel-subscription.use-case';
import { GetOrganizationSubscriptionUseCase } from './application/use-cases/get-organization-subscription.use-case';
import { GetOrganizationSubscriptionUsageUseCase } from './application/use-cases/get-organization-subscription-usage.use-case';
import { ListSubscriptionPlansUseCase } from './application/use-cases/list-subscription-plans.use-case';
import { ExpireSubscriptionUseCase } from './application/use-cases/expire-subscription.use-case';
import { PrismaSubscriptionRepository } from './infrastructure/persistence/prisma-subscription.repository';
import { PrismaSubscriptionPlanRepository } from './infrastructure/persistence/prisma-subscription-plan.repository';
import { PrismaSubscriptionUsageRepository } from './infrastructure/persistence/prisma-subscription-usage.repository';
import { SUBSCRIPTION_EXPIRATION_QUEUE_NAME } from './infrastructure/bullmq/subscription-queue.constants';
import { BullMqSubscriptionExpirationScheduler } from './infrastructure/bullmq/subscription-expiration.scheduler';
import { ExpireSubscriptionProcessor } from './infrastructure/bullmq/expire-subscription.processor';
import { PlatformAdminSubscriptionsController } from './presentation/controllers/platform-admin-subscriptions.controller';
import { OrganizationSubscriptionController } from './presentation/controllers/organization-subscription.controller';

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027;
 * implementation authorized and delivered 2026-07-28). Entitlement/
 * access-contract system - NOT billing. PlatformAdmin management
 * (`PlatformAdminSubscriptionsController`, PlatformAdmin-only) plus
 * Organization Owner/Admin read-only visibility
 * (`OrganizationSubscriptionController`) plus the System-only BullMQ
 * expiration consumer (`ExpireSubscriptionProcessor`/
 * `SubscriptionExpirationQueue`, mirroring `OffersModule`'s own
 * one-queue-per-concern precedent). Depends on `RestaurantsModule` for
 * `RESTAURANT_REPOSITORY` (downgrade-validation/usage-read restaurant
 * listing) and `RESTAURANT_USAGE_REPOSITORY` (the per-Restaurant counter
 * half of `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant`, owned by
 * the Restaurant Aggregate per ADR-027). Depends on `PlatformAdminModule`
 * for `PlatformAdminGuard`. `SUBSCRIPTION_REPOSITORY`/
 * `SUBSCRIPTION_PLAN_REPOSITORY`/`SUBSCRIPTION_USAGE_REPOSITORY` are
 * exported so `AuthenticationModule`'s `ProvisionRestaurantOwnerUseCase`
 * (Organization creation) can provision the default Subscription/
 * SubscriptionUsage in the same transaction (D7/ADR-027 §11) - see that
 * module's own updated doc comment for the exact integration.
 * `AuthenticationModule` imports this module and vice versa (this module
 * needs `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER`/`UNIT_OF_WORK`/
 * `TENANT_CONTEXT_PORT` from `AuthenticationModule`; `AuthenticationModule`
 * needs `SUBSCRIPTION_REPOSITORY`/`SUBSCRIPTION_USAGE_REPOSITORY` from here)
 * - a genuine circular pair, resolved with `forwardRef` on both sides.
 * `RestaurantsModule` imports this module too (for `SUBSCRIPTION_REPOSITORY`/
 * `SUBSCRIPTION_PLAN_REPOSITORY`/`SUBSCRIPTION_USAGE_REPOSITORY`, needed by
 * `CreateRestaurantUseCase`/`DeleteRestaurantUseCase`), making this a
 * three-module cycle overall (`RestaurantsModule` ↔ `AuthenticationModule` ↔
 * `SubscriptionsModule` ↔ `RestaurantsModule`) - `forwardRef` is applied on
 * every cycle-participating edge on both sides (see `RestaurantsModule`'s
 * and `PlatformAdminModule`'s own doc comments), matching this codebase's
 * existing precedent for genuine circular pairs
 * (`BranchesModule`↔`TablesModule`, `TablesModule`↔`ReservationsModule`).
 * `PlatformAdminModule` (for `PlatformAdminGuard`) is imported plainly -
 * it does not import this module back, so it is not part of the cycle.
 */
@Module({
  imports: [
    forwardRef(() => AuthenticationModule),
    AuthorizationModule,
    forwardRef(() => RestaurantsModule),
    PlatformAdminModule,
    BullModule.registerQueue({ name: SUBSCRIPTION_EXPIRATION_QUEUE_NAME }),
  ],
  controllers: [PlatformAdminSubscriptionsController, OrganizationSubscriptionController],
  providers: [
    AssignSubscriptionUseCase,
    SuspendSubscriptionUseCase,
    ReactivateSubscriptionUseCase,
    CancelSubscriptionUseCase,
    GetOrganizationSubscriptionUseCase,
    GetOrganizationSubscriptionUsageUseCase,
    ListSubscriptionPlansUseCase,
    ExpireSubscriptionUseCase,
    ExpireSubscriptionProcessor,
    PrismaSubscriptionRepository,
    PrismaSubscriptionPlanRepository,
    PrismaSubscriptionUsageRepository,
    { provide: SUBSCRIPTION_REPOSITORY, useExisting: PrismaSubscriptionRepository },
    { provide: SUBSCRIPTION_PLAN_REPOSITORY, useExisting: PrismaSubscriptionPlanRepository },
    { provide: SUBSCRIPTION_USAGE_REPOSITORY, useExisting: PrismaSubscriptionUsageRepository },
    BullMqSubscriptionExpirationScheduler,
    {
      provide: SUBSCRIPTION_EXPIRATION_SCHEDULER,
      useExisting: BullMqSubscriptionExpirationScheduler,
    },
  ],
  exports: [SUBSCRIPTION_REPOSITORY, SUBSCRIPTION_PLAN_REPOSITORY, SUBSCRIPTION_USAGE_REPOSITORY],
})
export class SubscriptionsModule {}
