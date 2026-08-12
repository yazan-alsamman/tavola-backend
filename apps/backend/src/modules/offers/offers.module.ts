import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { OFFER_REPOSITORY } from './domain/repositories/offer.repository';
import { OFFER_EXPIRATION_SCHEDULER } from './application/ports/offer-expiration-scheduler.port';
import { CreateOfferUseCase } from './application/use-cases/create-offer.use-case';
import { UpdateOfferUseCase } from './application/use-cases/update-offer.use-case';
import { PublishOfferUseCase } from './application/use-cases/publish-offer.use-case';
import { DeleteOfferUseCase } from './application/use-cases/delete-offer.use-case';
import { ListRestaurantOffersUseCase } from './application/use-cases/list-restaurant-offers.use-case';
import { ListPublicOffersUseCase } from './application/use-cases/list-public-offers.use-case';
import { ListRestaurantIdsWithActiveOfferUseCase } from './application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ExpireOfferUseCase } from './application/use-cases/expire-offer.use-case';
import { PrismaOfferRepository } from './infrastructure/persistence/prisma-offer.repository';
import { OFFER_EXPIRATION_QUEUE_NAME } from './infrastructure/bullmq/offer-queue.constants';
import { BullMqOfferExpirationScheduler } from './infrastructure/bullmq/offer-expiration.scheduler';
import { ExpireOfferProcessor } from './infrastructure/bullmq/expire-offer.processor';
import { OffersController } from './presentation/controllers/offers.controller';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28, implemented
 * 2026-07-28). Organization-administrative management (`OffersController`,
 * Owner/Admin only) plus the System-only BullMQ expiration consumer
 * (`ExpireOfferProcessor`/`OfferExpirationQueue`, mirroring
 * `ReservationsModule`'s own one-queue-per-concern precedent). Depends on
 * `RestaurantsModule` for `RESTAURANT_REPOSITORY` (tenant isolation gate -
 * `Offer` is not in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`, so
 * every use case resolves the parent Restaurant first, exactly like
 * `ReviewsModule`). `OFFER_REPOSITORY`, `ListPublicOffersUseCase`, and (Phase
 * 15.5, Discovery Module, architecture frozen 2026-07-29)
 * `ListRestaurantIdsWithActiveOfferUseCase` are exported so `DiscoveryModule`
 * can compose the public read surface (`GET /discovery/restaurants/:restaurantId/offers`,
 * and the `hasActiveOffer` annotation on search/nearby/comparison results)
 * without duplicating Offer business logic - see each use case's own doc
 * comment.
 */
@Module({
  imports: [
    // Phase 19.8 (Owner Invite, ADR-036) correction: forwardRef - see
    // branches.module.ts's matching fix for the exact boot-time symptom.
    forwardRef(() => AuthenticationModule),
    AuthorizationModule,
    RestaurantsModule,
    BullModule.registerQueue({ name: OFFER_EXPIRATION_QUEUE_NAME }),
  ],
  controllers: [OffersController],
  providers: [
    CreateOfferUseCase,
    UpdateOfferUseCase,
    PublishOfferUseCase,
    DeleteOfferUseCase,
    ListRestaurantOffersUseCase,
    ListPublicOffersUseCase,
    ListRestaurantIdsWithActiveOfferUseCase,
    ExpireOfferUseCase,
    ExpireOfferProcessor,
    PrismaOfferRepository,
    { provide: OFFER_REPOSITORY, useExisting: PrismaOfferRepository },
    BullMqOfferExpirationScheduler,
    { provide: OFFER_EXPIRATION_SCHEDULER, useExisting: BullMqOfferExpirationScheduler },
  ],
  exports: [OFFER_REPOSITORY, ListPublicOffersUseCase, ListRestaurantIdsWithActiveOfferUseCase],
})
export class OffersModule {}
