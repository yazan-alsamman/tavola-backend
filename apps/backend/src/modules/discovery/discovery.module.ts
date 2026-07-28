import { Module } from '@nestjs/common';
import { DISCOVERY_READER } from './application/ports/discovery-reader.port';
import { PrismaDiscoveryReader } from './infrastructure/persistence/prisma-discovery-reader';
import { ListDiscoverableRestaurantsUseCase } from './application/use-cases/list-discoverable-restaurants.use-case';
import { GetDiscoverableRestaurantUseCase } from './application/use-cases/get-discoverable-restaurant.use-case';
import { ListDiscoverableBranchesUseCase } from './application/use-cases/list-discoverable-branches.use-case';
import { GetDiscoverableBranchUseCase } from './application/use-cases/get-discoverable-branch.use-case';
import { GetDiscoverableFloorPlanUseCase } from './application/use-cases/get-discoverable-floor-plan.use-case';
import { DiscoveryController } from './presentation/controllers/discovery.controller';

/**
 * Customer Restaurant Discovery & Public Read Surface. Deliberately imports
 * no other feature module - `PrismaDiscoveryReader` queries the raw
 * `PrismaService` directly (see its own doc comment), so this module needs
 * neither `RestaurantsModule`/`BranchesModule`/`TablesModule`'s
 * tenant-scoped repositories nor their guards. Every route is public/
 * unauthenticated (ADR-018 §4) - no `AuthenticationModule`/
 * `AuthorizationModule` import either.
 */
@Module({
  controllers: [DiscoveryController],
  providers: [
    ListDiscoverableRestaurantsUseCase,
    GetDiscoverableRestaurantUseCase,
    ListDiscoverableBranchesUseCase,
    GetDiscoverableBranchUseCase,
    GetDiscoverableFloorPlanUseCase,
    PrismaDiscoveryReader,
    { provide: DISCOVERY_READER, useExisting: PrismaDiscoveryReader },
  ],
})
export class DiscoveryModule {}
