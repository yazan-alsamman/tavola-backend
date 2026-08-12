import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StorageConfig } from '@config/storage.config';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { FilesModule } from '@modules/files/files.module';
import { SubmitReviewUseCase } from './application/use-cases/submit-review.use-case';
import { DeleteReviewUseCase } from './application/use-cases/delete-review.use-case';
import { ReplyToReviewUseCase } from './application/use-cases/reply-to-review.use-case';
import { AddReviewImageUseCase } from './application/use-cases/add-review-image.use-case';
import { DeleteReviewImageUseCase } from './application/use-cases/delete-review-image.use-case';
import { ListRestaurantReviewsUseCase } from './application/use-cases/list-restaurant-reviews.use-case';
import { ListMyReviewsUseCase } from './application/use-cases/list-my-reviews.use-case';
import { GetReviewUseCase } from './application/use-cases/get-review.use-case';
import { ReviewResultAssembler } from './application/services/review-result-assembler.service';
import { REVIEW_REPOSITORY } from './domain/repositories/review.repository';
import { REVIEW_IMAGE_REPOSITORY } from './domain/repositories/review-image.repository';
import { RESTAURANT_REPLY_REPOSITORY } from './domain/repositories/restaurant-reply.repository';
import { PrismaReviewRepository } from './infrastructure/persistence/prisma-review.repository';
import { PrismaReviewImageRepository } from './infrastructure/persistence/prisma-review-image.repository';
import { PrismaRestaurantReplyRepository } from './infrastructure/persistence/prisma-restaurant-reply.repository';
import { REVIEW_IMAGES_BUCKET } from './application/tokens/reviews.tokens';
import { ReviewsController } from './presentation/controllers/reviews.controller';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26). Depends on
 * `AuthenticationModule` for `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER`/
 * `UNIT_OF_WORK`/`USER_REPOSITORY` (the same shared tokens every other
 * module reuses) and `JwtAuthGuard`/`SessionVersionGuard`; `AuthorizationModule`
 * for `OrganizationMemberGuard` (Reply's Owner/Admin-only route - no new
 * permission slug, so `PermissionsGuard` is never used here).
 * `RestaurantsModule` supplies `RESTAURANT_REPOSITORY` (tenant resolution,
 * `averageRating` recompute, and the public `existsPubliclyById` existence
 * check) and is imported one-directionally - `RestaurantsModule` never
 * imports this module back. `ReservationsModule` supplies
 * `RESERVATION_REPOSITORY` for Submit Review's eligibility check
 * (Completed + ownership). `FilesModule` supplies the Files aggregate's
 * persistence + storage ports (`FILE_REPOSITORY`, `STORAGE_PORT`) that
 * Review Images reuse completely, identical to Restaurant Gallery's own
 * reuse - no second upload subsystem. `REVIEW_IMAGES_BUCKET` resolves to the
 * same existing public bucket Gallery/Avatar already use - no new bucket, no
 * new storage strategy. `Review`/`ReviewImage`/`RestaurantReply` carry no
 * `organizationId` column and are not in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md) - tenant resolution is
 * transitive via `Review.restaurantId -> Restaurant.organizationId`.
 */
@Module({
  imports: [
    // Phase 19.8 (Owner Invite, ADR-036) correction: forwardRef - see
    // branches.module.ts's matching fix for the exact boot-time symptom.
    forwardRef(() => AuthenticationModule),
    AuthorizationModule,
    RestaurantsModule,
    ReservationsModule,
    FilesModule,
    PrismaModule,
    ConfigModule,
  ],
  controllers: [ReviewsController],
  providers: [
    SubmitReviewUseCase,
    DeleteReviewUseCase,
    ReplyToReviewUseCase,
    AddReviewImageUseCase,
    DeleteReviewImageUseCase,
    ListRestaurantReviewsUseCase,
    ListMyReviewsUseCase,
    GetReviewUseCase,
    ReviewResultAssembler,
    PrismaReviewRepository,
    PrismaReviewImageRepository,
    PrismaRestaurantReplyRepository,
    { provide: REVIEW_REPOSITORY, useExisting: PrismaReviewRepository },
    { provide: REVIEW_IMAGE_REPOSITORY, useExisting: PrismaReviewImageRepository },
    { provide: RESTAURANT_REPLY_REPOSITORY, useExisting: PrismaRestaurantReplyRepository },
    {
      provide: REVIEW_IMAGES_BUCKET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): string =>
        configService.getOrThrow<StorageConfig>('storage').publicBucket,
    },
  ],
  // Phase 20.X: ListMyReviewsUseCase exported so UsersModule's
  // ExportUserDataUseCase can reuse it verbatim - one-directional,
  // ReviewsModule never imports UsersModule back.
  exports: [ListMyReviewsUseCase],
})
export class ReviewsModule {}
