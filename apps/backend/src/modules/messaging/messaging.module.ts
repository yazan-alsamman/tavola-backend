import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '@config/storage.config';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { FilesModule } from '@modules/files/files.module';
import { RedisSlidingWindowRateLimiter } from '@modules/authentication/infrastructure/redis/redis-sliding-window-rate-limiter';
import { CONVERSATION_REPOSITORY } from './domain/repositories/conversation.repository';
import { CONVERSATION_PARTICIPANT_REPOSITORY } from './domain/repositories/conversation-participant.repository';
import { MESSAGE_REPOSITORY } from './domain/repositories/message.repository';
import {
  MESSAGING_RATE_LIMITER,
  IDEMPOTENCY_STORE,
  MESSAGE_ATTACHMENTS_BUCKET,
} from './domain/tokens/messaging.tokens';
import { PrismaConversationRepository } from './infrastructure/persistence/prisma-conversation.repository';
import { PrismaConversationParticipantRepository } from './infrastructure/persistence/prisma-conversation-participant.repository';
import { PrismaMessageRepository } from './infrastructure/persistence/prisma-message.repository';
import { RedisIdempotencyStore } from './infrastructure/redis/redis-idempotency-store';
import { ConversationAccessService } from './application/services/conversation-access.service';
import { ConversationParticipantResolverService } from './application/services/conversation-participant-resolver.service';
import { StartConversationUseCase } from './application/use-cases/start-conversation.use-case';
import { GetConversationUseCase } from './application/use-cases/get-conversation.use-case';
import { SendMessageUseCase } from './application/use-cases/send-message.use-case';
import { ListMessagesUseCase } from './application/use-cases/list-messages.use-case';
import { ListCustomerConversationsUseCase } from './application/use-cases/list-customer-conversations.use-case';
import { ListRestaurantConversationsUseCase } from './application/use-cases/list-restaurant-conversations.use-case';
import { MarkConversationReadUseCase } from './application/use-cases/mark-conversation-read.use-case';
import { CloseConversationUseCase } from './application/use-cases/close-conversation.use-case';
import { MessagingSendRateLimitGuard } from './presentation/guards/messaging-send-rate-limit.guard';
import { MessagingIdempotencyInterceptor } from './presentation/interceptors/messaging-idempotency.interceptor';
import { ConversationsController } from './presentation/controllers/conversations.controller';
import { RestaurantConversationsController } from './presentation/controllers/restaurant-conversations.controller';

/**
 * Phase 15.6 (Messaging, ADR-020 corrected by ADR-030). Imports
 * `RestaurantsModule`/`BranchesModule`/`ReservationsModule` for the
 * tenancy-resolution gate (D1) and `reservationId` linkage (D4), and
 * `FilesModule` for `FILE_REPOSITORY`/`STORAGE_PORT` (D7 inline attachment
 * upload) - compositional reuse, no duplicated logic. Exports its three
 * repository tokens so `RealtimeModule` (`RoomAuthorizationService`, D9) and
 * `NotificationsModule` (`NotificationDispatcher`, D6) can resolve
 * `Conversation`/`ConversationParticipant` without this module ever
 * importing either back (one-directional, matches `RealtimeModule`'s own
 * documented acyclic-graph discipline). `MESSAGING_RATE_LIMITER`/
 * `IDEMPOTENCY_STORE` reuse existing Redis infrastructure under Messaging's
 * own tokens (D8/D12), mirroring `DISCOVERY_RATE_LIMITER`'s precedent - not
 * a second architecture. `MESSAGE_ATTACHMENTS_BUCKET` resolves to
 * `storage.privateBucket` (D7 - chat attachments are never public).
 */
@Module({
  imports: [
    // Phase 19.8 (Owner Invite, ADR-036) correction: forwardRef - see
    // branches.module.ts's matching fix for the exact boot-time symptom.
    forwardRef(() => AuthenticationModule),
    RestaurantsModule,
    BranchesModule,
    ReservationsModule,
    FilesModule,
  ],
  controllers: [ConversationsController, RestaurantConversationsController],
  providers: [
    PrismaConversationRepository,
    { provide: CONVERSATION_REPOSITORY, useExisting: PrismaConversationRepository },
    PrismaConversationParticipantRepository,
    {
      provide: CONVERSATION_PARTICIPANT_REPOSITORY,
      useExisting: PrismaConversationParticipantRepository,
    },
    PrismaMessageRepository,
    { provide: MESSAGE_REPOSITORY, useExisting: PrismaMessageRepository },
    RedisSlidingWindowRateLimiter,
    { provide: MESSAGING_RATE_LIMITER, useExisting: RedisSlidingWindowRateLimiter },
    RedisIdempotencyStore,
    { provide: IDEMPOTENCY_STORE, useExisting: RedisIdempotencyStore },
    {
      provide: MESSAGE_ATTACHMENTS_BUCKET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): string =>
        configService.getOrThrow<StorageConfig>('storage').privateBucket,
    },
    ConversationAccessService,
    ConversationParticipantResolverService,
    StartConversationUseCase,
    GetConversationUseCase,
    SendMessageUseCase,
    ListMessagesUseCase,
    ListCustomerConversationsUseCase,
    ListRestaurantConversationsUseCase,
    MarkConversationReadUseCase,
    CloseConversationUseCase,
    MessagingSendRateLimitGuard,
    MessagingIdempotencyInterceptor,
  ],
  exports: [CONVERSATION_REPOSITORY, CONVERSATION_PARTICIPANT_REPOSITORY, MESSAGE_REPOSITORY],
})
export class MessagingModule {}
