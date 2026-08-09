import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { StorageConfig } from '@config/storage.config';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { FilesModule } from '@modules/files/files.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { WaitlistModule } from '@modules/waitlist/waitlist.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { GetCurrentUserProfileUseCase } from './application/use-cases/get-current-user-profile.use-case';
import { UpdateUserProfileUseCase } from './application/use-cases/update-user-profile.use-case';
import { UploadCurrentUserAvatarUseCase } from './application/use-cases/upload-current-user-avatar.use-case';
import { AddFavoriteUseCase } from './application/use-cases/add-favorite.use-case';
import { RemoveFavoriteUseCase } from './application/use-cases/remove-favorite.use-case';
import { ListCurrentUserFavoritesUseCase } from './application/use-cases/list-current-user-favorites.use-case';
import { GetCurrentUserPreferencesUseCase } from './application/use-cases/get-current-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from './application/use-cases/update-user-preferences.use-case';
import { RequestAccountDeletionUseCase } from './application/use-cases/request-account-deletion.use-case';
import { CancelAccountDeletionUseCase } from './application/use-cases/cancel-account-deletion.use-case';
import { AnonymizeUserAccountUseCase } from './application/use-cases/anonymize-user-account.use-case';
import { ExportUserDataUseCase } from './application/use-cases/export-user-data.use-case';
import { AVATAR_BUCKET } from './application/tokens/users.tokens';
import { RESTAURANT_DIRECTORY_READER } from './application/ports/restaurant-directory-reader.port';
import { ACCOUNT_DELETION_SCHEDULER } from './application/ports/account-deletion-scheduler.port';
import { FAVORITE_RESTAURANT_REPOSITORY } from './domain/repositories/favorite-restaurant.repository';
import { PrismaFavoriteRestaurantRepository } from './infrastructure/persistence/prisma-favorite-restaurant.repository';
import { PrismaRestaurantDirectoryReader } from './infrastructure/persistence/prisma-restaurant-directory-reader';
import { ACCOUNT_DELETION_QUEUE_NAME } from './infrastructure/bullmq/account-deletion-queue.constants';
import { BullMqAccountDeletionScheduler } from './infrastructure/bullmq/bullmq-account-deletion.scheduler';
import { AnonymizeUserAccountProcessor } from './infrastructure/bullmq/anonymize-user-account.processor';
import { UsersController } from './presentation/controllers/users.controller';

/**
 * Phase 3.1 (User Profile) + Phase 3.2 (Avatar Upload). Depends on
 * AuthenticationModule for the User aggregate's repository/clock ports
 * (USER_REPOSITORY, CLOCK) rather than defining a second persistence path
 * for the same aggregate - Authentication remains the sole owner of User
 * persistence; this module adds profile/avatar application use cases and
 * presentation on top of that existing port, per DOMAIN_MODEL.md's
 * "communicate through interfaces" bounded-context rule. FilesModule
 * supplies the Files aggregate's persistence + storage ports (FILE_REPOSITORY,
 * STORAGE_PORT) that avatar upload reuses rather than duplicating.
 *
 * Phase 3.3 (Favorites) adds `FavoriteRestaurant` (a User child entity per
 * DOMAIN_MODEL.md) and its own minimal, read-only
 * `RestaurantDirectoryReaderPort` - not a full Restaurants module (Phase 4
 * is still pending) - required because Favorites is customer-facing and a
 * plain `User` actor has no `organizationId` to scope a tenant-owned
 * `Restaurant` query by. See `PrismaRestaurantDirectoryReader`'s own doc
 * comment for why this is architecturally distinct from a `$systemContext`
 * use.
 *
 * Phase 3.4 (Preferences) adds `notificationOptIn`/`marketingOptIn` as two
 * plain columns on the existing `User` aggregate root - not a new
 * `UserPreference` child entity/aggregate. `language`/`preferredCurrency`
 * were already shipped directly on `User` in Phase 3.1; the standalone
 * `UserPreference` table previously documented in DATABASE_SCHEMA.md /
 * DOMAIN_MODEL.md was never implemented and predates that decision - it is
 * corrected in documentation rather than built (see DECISIONS.md). No new
 * repository/port was needed - `USER_REPOSITORY` (from AuthenticationModule)
 * already covers the whole `User` row.
 *
 * Phase 20.X (Account Deletion, ADR-014 execution) adds three new one-
 * directional imports, none of which import this module back:
 * `MessagingModule` (MESSAGE_REPOSITORY, for anonymizing this user's own
 * messages), `WaitlistModule` (RESERVATION_WAITLIST_ENTRY_REPOSITORY +
 * the exported CancelWaitlistEntryUseCase, reused verbatim rather than
 * re-derived), `ReservationsModule` (RESERVATION_REPOSITORY for the open-
 * reservations gate, plus the exported ListMyReservationsUseCase) and
 * `ReviewsModule` (the exported ListMyReviewsUseCase) - the latter two
 * reused by ExportUserDataUseCase. A dedicated `AccountDeletionQueue`
 * mirrors `SubscriptionExpirationQueue`'s registration shape exactly.
 */
@Module({
  imports: [
    AuthenticationModule,
    FilesModule,
    MessagingModule,
    WaitlistModule,
    ReservationsModule,
    ReviewsModule,
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({ name: ACCOUNT_DELETION_QUEUE_NAME }),
  ],
  controllers: [UsersController],
  providers: [
    GetCurrentUserProfileUseCase,
    UpdateUserProfileUseCase,
    UploadCurrentUserAvatarUseCase,
    AddFavoriteUseCase,
    RemoveFavoriteUseCase,
    ListCurrentUserFavoritesUseCase,
    GetCurrentUserPreferencesUseCase,
    UpdateUserPreferencesUseCase,
    RequestAccountDeletionUseCase,
    CancelAccountDeletionUseCase,
    AnonymizeUserAccountUseCase,
    ExportUserDataUseCase,
    AnonymizeUserAccountProcessor,
    PrismaFavoriteRestaurantRepository,
    PrismaRestaurantDirectoryReader,
    { provide: FAVORITE_RESTAURANT_REPOSITORY, useExisting: PrismaFavoriteRestaurantRepository },
    { provide: RESTAURANT_DIRECTORY_READER, useExisting: PrismaRestaurantDirectoryReader },
    BullMqAccountDeletionScheduler,
    { provide: ACCOUNT_DELETION_SCHEDULER, useExisting: BullMqAccountDeletionScheduler },
    {
      provide: AVATAR_BUCKET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): string =>
        configService.getOrThrow<StorageConfig>('storage').publicBucket,
    },
  ],
})
export class UsersModule {}
