import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { WaitlistModule } from '@modules/waitlist/waitlist.module';
import { OneSignalNotificationProvider } from '@infrastructure/notifications/providers/onesignal/onesignal-notification.provider';
import { NOTIFICATION_REPOSITORY } from './domain/repositories/notification.repository';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from './domain/repositories/notification-template.repository';
import { PrismaNotificationRepository } from './infrastructure/persistence/prisma-notification.repository';
import { PrismaNotificationTemplateRepository } from './infrastructure/persistence/prisma-notification-template.repository';
import { NOTIFICATION_PROVIDER } from './application/ports/notification-provider.port';
import { NOTIFICATION_DELIVERY_SCHEDULER } from './application/ports/notification-delivery-scheduler.port';
import { BullMqNotificationDeliveryScheduler } from './infrastructure/bullmq/bullmq-notification-delivery.scheduler';
import { NOTIFICATION_QUEUE_NAME } from './infrastructure/bullmq/notification-queue.constants';
import { NotificationDeliveryProcessor } from './infrastructure/bullmq/notification-delivery.processor';
import { NotificationDispatcher } from './application/services/notification-dispatcher.service';
import { ProcessNotificationDeliveryUseCase } from './application/use-cases/process-notification-delivery.use-case';
import { ListNotificationsUseCase } from './application/use-cases/list-notifications.use-case';
import { MarkNotificationReadUseCase } from './application/use-cases/mark-notification-read.use-case';
import { MarkAllNotificationsReadUseCase } from './application/use-cases/mark-all-notifications-read.use-case';
import { GetUnreadNotificationCountUseCase } from './application/use-cases/get-unread-notification-count.use-case';
import { GetOneSignalIdentityTokenUseCase } from './application/use-cases/get-onesignal-identity-token.use-case';
import { NotificationsController } from './presentation/controllers/notifications.controller';

/**
 * Phase 9 — Notification System (architecture frozen 2026-07-25, TASKS.md's
 * "Phase 9 — Notification System: Pre-implementation architecture
 * decisions"). Imports `AuthenticationModule` for `USER_REPOSITORY`/`CLOCK`/
 * `ID_GENERATOR` (recipient resolution + opt-in gating), `ReservationsModule`
 * for `RESERVATION_REPOSITORY` (resolving a Reservation-sourced event's
 * recipient `User`), and `WaitlistModule` for
 * `RESERVATION_WAITLIST_ENTRY_REPOSITORY` (resolving a `WaitlistEntryPromoted`
 * recipient and activating `WaitlistEntryNotified` after push acceptance,
 * decision item 7) - all one-directional; none of those modules import this
 * one back. `EVENT_PUBLISHER` is not listed as an import: `RealtimeModule`
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
 */
@Module({
  imports: [
    PrismaModule,
    AuthenticationModule,
    ReservationsModule,
    WaitlistModule,
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE_NAME }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationDispatcher,
    ProcessNotificationDeliveryUseCase,
    ListNotificationsUseCase,
    MarkNotificationReadUseCase,
    MarkAllNotificationsReadUseCase,
    GetUnreadNotificationCountUseCase,
    GetOneSignalIdentityTokenUseCase,
    NotificationDeliveryProcessor,
    PrismaNotificationRepository,
    { provide: NOTIFICATION_REPOSITORY, useExisting: PrismaNotificationRepository },
    PrismaNotificationTemplateRepository,
    {
      provide: NOTIFICATION_TEMPLATE_REPOSITORY,
      useExisting: PrismaNotificationTemplateRepository,
    },
    OneSignalNotificationProvider,
    { provide: NOTIFICATION_PROVIDER, useExisting: OneSignalNotificationProvider },
    BullMqNotificationDeliveryScheduler,
    { provide: NOTIFICATION_DELIVERY_SCHEDULER, useExisting: BullMqNotificationDeliveryScheduler },
  ],
  exports: [NotificationDispatcher],
})
export class NotificationsModule {}
