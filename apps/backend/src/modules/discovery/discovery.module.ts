import { Module } from '@nestjs/common';
import { OffersModule } from '@modules/offers/offers.module';
import { MenusModule } from '@modules/menus/menus.module';
import { RedisSlidingWindowRateLimiter } from '@modules/authentication/infrastructure/redis/redis-sliding-window-rate-limiter';
import { DISCOVERY_READER } from './application/ports/discovery-reader.port';
import { DISCOVERY_RATE_LIMITER } from './domain/tokens/discovery.tokens';
import { PrismaDiscoveryReader } from './infrastructure/persistence/prisma-discovery-reader';
import { CachingDiscoveryReader } from './infrastructure/persistence/caching-discovery-reader';
import { ListDiscoverableRestaurantsUseCase } from './application/use-cases/list-discoverable-restaurants.use-case';
import { GetDiscoverableRestaurantUseCase } from './application/use-cases/get-discoverable-restaurant.use-case';
import { ListDiscoverableBranchesUseCase } from './application/use-cases/list-discoverable-branches.use-case';
import { GetDiscoverableBranchUseCase } from './application/use-cases/get-discoverable-branch.use-case';
import { GetDiscoverableFloorPlanUseCase } from './application/use-cases/get-discoverable-floor-plan.use-case';
import { ListDiscoverableOffersUseCase } from './application/use-cases/list-discoverable-offers.use-case';
import { NearbyRestaurantsUseCase } from './application/use-cases/nearby-restaurants.use-case';
import { CompareRestaurantsUseCase } from './application/use-cases/compare-restaurants.use-case';
import { DiscoveryController } from './presentation/controllers/discovery.controller';
import { DiscoveryRateLimitGuard } from './presentation/guards/discovery-rate-limit.guard';

/**
 * Customer Restaurant Discovery & Public Read Surface, extended by Phase
 * 15.5 (Discovery Module, architecture frozen 2026-07-29). Imports only
 * `OffersModule` (Phase 11, plus Phase 15.5's `ListRestaurantIdsWithActiveOfferUseCase`)
 * - compositional reuse, never duplicated Offer business logic (see
 * `ListDiscoverableOffersUseCase`/`ListRestaurantIdsWithActiveOfferUseCase`'s
 * own doc comments). `PrismaDiscoveryReader` still queries the raw
 * `PrismaService` directly for Restaurant/Branch/FloorPlan/Table (see its own
 * doc comment), so this module needs neither `RestaurantsModule`/
 * `BranchesModule`/`TablesModule`'s tenant-scoped repositories nor their
 * guards for those. Every route is public/unauthenticated (ADR-018 §4) - no
 * `AuthenticationModule`/`AuthorizationModule` import for guarding routes;
 * `DISCOVERY_RATE_LIMITER` reuses only the `RedisSlidingWindowRateLimiter`
 * *class* from Authentication's infrastructure (the algorithm/primitive, not
 * its module/policy registry) - `REDIS_CACHE_CLIENT` is `@Global()`, so this
 * needs no `AuthenticationModule` import either (D12 - see
 * `DiscoveryRateLimitGuard`'s own doc comment for why this is deliberately
 * not a coupling into Authentication's bounded context).
 */
@Module({
  imports: [OffersModule, MenusModule],
  controllers: [DiscoveryController],
  providers: [
    ListDiscoverableRestaurantsUseCase,
    GetDiscoverableRestaurantUseCase,
    ListDiscoverableBranchesUseCase,
    GetDiscoverableBranchUseCase,
    GetDiscoverableFloorPlanUseCase,
    ListDiscoverableOffersUseCase,
    NearbyRestaurantsUseCase,
    CompareRestaurantsUseCase,
    PrismaDiscoveryReader,
    CachingDiscoveryReader,
    // Post-Audit Remediation (2026-08-02, L7): DISCOVERY_READER now resolves
    // to the caching decorator (30s TTL on listRestaurants/searchNearby),
    // which itself wraps PrismaDiscoveryReader directly - see that class's
    // own doc comment.
    { provide: DISCOVERY_READER, useExisting: CachingDiscoveryReader },
    RedisSlidingWindowRateLimiter,
    { provide: DISCOVERY_RATE_LIMITER, useExisting: RedisSlidingWindowRateLimiter },
    DiscoveryRateLimitGuard,
  ],
})
export class DiscoveryModule {}
