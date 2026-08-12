import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { PlatformAdminModule } from '@modules/platform-admin/platform-admin.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { WaitlistModule } from '@modules/waitlist/waitlist.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { OneSignalNotificationProvider } from '@infrastructure/notifications/providers/onesignal/onesignal-notification.provider';
import { NOTIFICATION_REPOSITORY } from './domain/repositories/notification.repository';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from './domain/repositories/notification-template.repository';
import { NOTIFICATION_BROADCAST_REPOSITORY } from './domain/repositories/notification-broadcast.repository';
import { PrismaNotificationRepository } from './infrastructure/persistence/prisma-notification.repository';
import { PrismaNotificationTemplateRepository } from './infrastructure/persistence/prisma-notification-template.repository';
import { PrismaNotificationBroadcastRepository } from './infrastructure/persistence/prisma-notification-broadcast.repository';
import { PrismaPlatformAdminNotificationStatsReader } from './infrastructure/persistence/prisma-platform-admin-notification-stats.reader';
import { PrismaCustomerAudienceReader } from './infrastructure/persistence/prisma-customer-audience.reader';
import { PLATFORM_ADMIN_NOTIFICATION_STATS_READER } from './application/ports/platform-admin-notification-stats-reader.port';
import { CUSTOMER_AUDIENCE_READER } from './application/ports/customer-audience-reader.port';
import { NOTIFICATION_PROVIDER } from './application/ports/notification-provider.port';
import { NOTIFICATION_DELIVERY_SCHEDULER } from './application/ports/notification-delivery-scheduler.port';
import { NOTIFICATION_BROADCAST_FANOUT_SCHEDULER } from './application/ports/notification-broadcast-fanout-scheduler.port';
import { BullMqNotificationDeliveryScheduler } from './infrastructure/bullmq/bullmq-notification-delivery.scheduler';
import { BullMqNotificationBroadcastFanoutScheduler } from './infrastructure/bullmq/bullmq-notification-broadcast-fanout.scheduler';
import { NOTIFICATION_QUEUE_NAME } from './infrastructure/bullmq/notification-queue.constants';
import { NotificationQueueProcessor } from './infrastructure/bullmq/notification-queue.processor';
import { NotificationDispatcher } from './application/services/notification-dispatcher.service';
import { CreateNotificationBroadcastService } from './application/services/create-notification-broadcast.service';
import { ProcessNotificationDeliveryUseCase } from './application/use-cases/process-notification-delivery.use-case';
import { ProcessNotificationBroadcastFanoutUseCase } from './application/use-cases/process-notification-broadcast-fanout.use-case';
import { ListNotificationsUseCase } from './application/use-cases/list-notifications.use-case';
import { MarkNotificationReadUseCase } from './application/use-cases/mark-notification-read.use-case';
import { MarkAllNotificationsReadUseCase } from './application/use-cases/mark-all-notifications-read.use-case';
import { GetUnreadNotificationCountUseCase } from './application/use-cases/get-unread-notification-count.use-case';
import { GetOneSignalIdentityTokenUseCase } from './application/use-cases/get-onesignal-identity-token.use-case';
import { SendNotificationToCustomerUseCase } from './application/use-cases/send-notification-to-customer.use-case';
import { SendPlatformAdminNotificationBroadcastUseCase } from './application/use-cases/send-platform-admin-notification-broadcast.use-case';
import { SendRestaurantOwnerNotificationBroadcastUseCase } from './application/use-cases/send-restaurant-owner-notification-broadcast.use-case';
import { NotificationsController } from './presentation/controllers/notifications.controller';
import { PlatformAdminNotificationsController } from './presentation/controllers/platform-admin-notifications.controller';
import { RestaurantNotificationsController } from './presentation/controllers/restaurant-notifications.controller';

/**
 * Phase 9 — Notification System (architecture frozen 2026-07-25, TASKS.md's
 * "Phase 9 — Notification System: Pre-implementation architecture
 * decisions"). Imports `AuthenticationModule` for `USER_REPOSITORY`/`CLOCK`/
 * `ID_GENERATOR` (recipient resolution + opt-in gating), `ReservationsModule`
 * for `RESERVATION_REPOSITORY` (resolving a Reservation-sourced event's
 * recipient `User`), and `WaitlistModule` for
 * `RESERVATION_WAITLIST_ENTRY_REPOSITORY` (resolving a `WaitlistEntryPromoted`
 * recipient and activating `WaitlistEntryNotified` after push acceptance,
 * decision item 7), and `MessagingModule` for
 * `CONVERSATION_PARTICIPANT_REPOSITORY` (Phase 15.6, DECISIONS.md D6 -
 * resolving a `MessageSent` notification's Customer-participant recipient)
 * - all one-directional; none of those modules import this one back.
 * `EVENT_PUBLISHER` is not listed as an import: `RealtimeModule`
 * is `@Global()` and exports it, resolved ambiently by
 * `ProcessNotificationDeliveryUseCase` exactly like every other consumer in
 * this codebase.
 *
 * `NotificationDispatcher` is exported so `RealtimeModule` (which imports
 * this module for exactly that reason) can build the new outermost
 * `NotifyingEventPublisher` decorator layer - see `RealtimeModule`'s own
 * doc comment for why this one-directional edge does not create a cycle.
 *
 * `NOTIFICATION_PROVIDER` is bound to `OneSignalNotificationProvider`
 * (ADR-007's Anti-Corruption Layer) - a test module overrides this binding
 * with `FakeNotificationProvider` rather than this module ever branching on
 * `NODE_ENV` itself.
 *
 * Phase 19.6 (Platform Dashboard Messaging section, ADR-035 Pattern 2): this
 * module's `AuthenticationModule` import is wrapped in `forwardRef`.
 * `PlatformAdminModule` now imports this module (also `forwardRef`) for
 * `PLATFORM_ADMIN_NOTIFICATION_STATS_READER`, and `PlatformAdminModule`
 * imports `AuthenticationModule` (`forwardRef`) - closing a genuine
 * three-module cycle (`NotificationsModule` -> `AuthenticationModule` ->
 * `PlatformAdminModule` -> `NotificationsModule`) that did not exist before,
 * resolved the same every-edge-`forwardRef` convention this codebase already
 * uses for the `RestaurantsModule`↔`AuthenticationModule`↔`SubscriptionsModule`
 * cycle.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AuthenticationModule),
    // Phase 19.9 (ADR-037) - PlatformAdminModule already forwardRef-imports
    // this module back (for PLATFORM_ADMIN_NOTIFICATION_STATS_READER), so
    // this new edge (PlatformAdminGuard/PlatformAdminRoleGuard for
    // PlatformAdminNotificationsController) is a direct bidirectional cycle,
    // resolved with forwardRef on both sides - the same
    // RestaurantsModule<->PlatformAdminModule<->CustomerAcquisitionModule
    // shape this codebase already uses.
    forwardRef(() => PlatformAdminModule),
    // AuthorizationModule (OrganizationMemberGuard/@RequireOrgRole for
    // RestaurantNotificationsController) and RestaurantsModule
    // (RESTAURANT_REPOSITORY, for validating a Restaurant Owner broadcast's
    // restaurantId belongs to the caller's own Organization) are both
    // one-directional - neither imports this module back.
    AuthorizationModule,
    RestaurantsModule,
    ReservationsModule,
    WaitlistModule,
    MessagingModule,
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE_NAME }),
  ],
  controllers: [
    NotificationsController,
    PlatformAdminNotificationsController,
    RestaurantNotificationsController,
  ],
  providers: [
    NotificationDispatcher,
    CreateNotificationBroadcastService,
    ProcessNotificationDeliveryUseCase,
    ProcessNotificationBroadcastFanoutUseCase,
    ListNotificationsUseCase,
    MarkNotificationReadUseCase,
    MarkAllNotificationsReadUseCase,
    GetUnreadNotificationCountUseCase,
    GetOneSignalIdentityTokenUseCase,
    SendNotificationToCustomerUseCase,
    SendPlatformAdminNotificationBroadcastUseCase,
    SendRestaurantOwnerNotificationBroadcastUseCase,
    NotificationQueueProcessor,
    PrismaNotificationRepository,
    { provide: NOTIFICATION_REPOSITORY, useExisting: PrismaNotificationRepository },
    PrismaNotificationTemplateRepository,
    {
      provide: NOTIFICATION_TEMPLATE_REPOSITORY,
      useExisting: PrismaNotificationTemplateRepository,
    },
    PrismaNotificationBroadcastRepository,
    {
      provide: NOTIFICATION_BROADCAST_REPOSITORY,
      useExisting: PrismaNotificationBroadcastRepository,
    },
    OneSignalNotificationProvider,
    { provide: NOTIFICATION_PROVIDER, useExisting: OneSignalNotificationProvider },
    BullMqNotificationDeliveryScheduler,
    { provide: NOTIFICATION_DELIVERY_SCHEDULER, useExisting: BullMqNotificationDeliveryScheduler },
    BullMqNotificationBroadcastFanoutScheduler,
    {
      provide: NOTIFICATION_BROADCAST_FANOUT_SCHEDULER,
      useExisting: BullMqNotificationBroadcastFanoutScheduler,
    },
    PrismaPlatformAdminNotificationStatsReader,
    {
      provide: PLATFORM_ADMIN_NOTIFICATION_STATS_READER,
      useExisting: PrismaPlatformAdminNotificationStatsReader,
    },
    PrismaCustomerAudienceReader,
    { provide: CUSTOMER_AUDIENCE_READER, useExisting: PrismaCustomerAudienceReader },
  ],
  // PLATFORM_ADMIN_NOTIFICATION_STATS_READER is exported for PlatformAdminModule
  // (Phase 19.6 — Platform Dashboard Messaging section, ADR-035 Pattern 2).
  exports: [NotificationDispatcher, PLATFORM_ADMIN_NOTIFICATION_STATS_READER],
})
export class NotificationsModule {}
