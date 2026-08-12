import { forwardRef, Global, Module } from '@nestjs/common';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuditingEventPublisher } from '@modules/authentication/infrastructure/events/auditing-event-publisher';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { BranchesModule } from '@modules/branches/branches.module';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { NotificationDispatcher } from '@modules/notifications/application/services/notification-dispatcher.service';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { WsAuthenticationService } from './application/ws-authentication.service';
import { RoomAuthorizationService } from './application/room-authorization.service';
import { SocketIoRealtimeBroadcaster } from './infrastructure/socket-io-realtime-broadcaster';
import { REALTIME_BROADCASTER } from './domain/ports/realtime-broadcaster.port';
import { RealtimeEventPublisher } from './infrastructure/events/realtime-event-publisher';
import { NotifyingEventPublisher } from '@modules/notifications/infrastructure/events/notifying-event-publisher';
import { RealtimeGateway } from './presentation/gateways/realtime.gateway';
import { EVENT_PUBLISHER } from '@shared/application/ports/event-publisher.port';

/**
 * Phase 8 (WebSocket, architecture frozen 2026-07-24) §20 — owns the entire
 * realtime protocol/infrastructure: the Gateway, handshake authentication,
 * room authorization, event -> room mapping, PII-safe projection, the
 * `RealtimeEventPublisher` decorator, and its `RealtimeBroadcasterPort`
 * implementation.
 *
 * `@Global()` is deliberate and load-bearing, not a convenience shortcut:
 * `EVENT_PUBLISHER` must become `RealtimeEventPublisher` for every existing
 * consumer (Reservations/Tables/Branches/Restaurants/Waitlist use cases)
 * WITHOUT any of those feature modules adding `RealtimeModule` to their own
 * `imports` - §20 explicitly forbids feature modules depending on this
 * module "merely to emit WebSocket updates". Marking this module global and
 * exporting `EVENT_PUBLISHER` from it (see providers below) makes the token
 * ambiently resolvable everywhere once `AppModule` imports this module a
 * single time, exactly mirroring how `AuditModule`/`TenancyModule`/etc.
 * already make their own tokens ambient in this codebase.
 *
 * This is also what keeps the module graph acyclic: this module imports
 * `AuthenticationModule`/`ReservationsModule`/`BranchesModule`/
 * `RestaurantsModule` (a strictly downward dependency), and NOTHING imports
 * this module back - `AuthenticationModule` no longer binds `EVENT_PUBLISHER`
 * itself (see its own doc comment), so it has no need to import this module,
 * which would otherwise have created a genuine cycle
 * (`AuthenticationModule -> RealtimeModule -> ReservationsModule ->
 * AuthenticationModule`).
 *
 * Phase 9 (architecture frozen 2026-07-25) adds `NotificationsModule` to
 * this same one-directional import list, purely to reach
 * `NotificationDispatcher` for the new `NotifyingEventPublisher` decorator
 * layer (below). `NotificationsModule` itself never imports `RealtimeModule`
 * back - it only injects `EVENT_PUBLISHER` (via `@Inject`, resolved
 * ambiently because this module is `@Global()`, exactly like every other
 * consumer of the token), which is a provider-level dependency satisfied
 * once `RealtimeEventPublisher` is constructed, not a module-import cycle.
 *
 * Phase 15.6 (Messaging, architecture designed 2026-07-30, D9) adds
 * `MessagingModule` to this same one-directional list, purely so
 * `RoomAuthorizationService.authorizeConversation` can reach
 * `ConversationRepository`/`ConversationParticipantRepository`.
 * `MessagingModule` never imports `RealtimeModule` back - its own realtime
 * fan-out happens through the ambient `EVENT_PUBLISHER` token exactly like
 * every other feature module, never a direct dependency on this module.
 */
@Global()
@Module({
  imports: [
    // Phase 19.8 (Owner Invite, ADR-036) correction: forwardRef - see
    // branches.module.ts's matching fix for the exact boot-time symptom.
    forwardRef(() => AuthenticationModule),
    ReservationsModule,
    BranchesModule,
    RestaurantsModule,
    NotificationsModule,
    MessagingModule,
  ],
  providers: [
    WsAuthenticationService,
    RoomAuthorizationService,
    RealtimeGateway,
    SocketIoRealtimeBroadcaster,
    { provide: REALTIME_BROADCASTER, useExisting: SocketIoRealtimeBroadcaster },
    {
      provide: EVENT_PUBLISHER,
      useFactory: (
        inner: AuditingEventPublisher,
        broadcaster: SocketIoRealtimeBroadcaster,
        branchRepository: BranchRepository,
        notificationDispatcher: NotificationDispatcher,
      ) => {
        const realtimePublisher = new RealtimeEventPublisher(inner, broadcaster, branchRepository);
        // Phase 9 (architecture frozen 2026-07-25) - the new outermost
        // decorator layer, added here rather than inside RealtimeEventPublisher
        // itself so Phase 8's own frozen class stays untouched.
        return new NotifyingEventPublisher(realtimePublisher, notificationDispatcher);
      },
      inject: [
        AuditingEventPublisher,
        REALTIME_BROADCASTER,
        BRANCH_REPOSITORY,
        NotificationDispatcher,
      ],
    },
  ],
  // Phase 19.9 (ADR-037) — `REALTIME_BROADCASTER` is now exported alongside
  // `EVENT_PUBLISHER`, ambiently resolvable exactly the same way, so
  // `NotificationBroadcastFanoutProcessor` (`NotificationsModule`) can emit
  // its one-per-batch `NotificationBroadcastDelivered` hint directly -
  // deliberately bypassing the standard `EVENT_PUBLISHER` -> domain-event
  // pipeline for bulk-inserted broadcast rows (ADR-037 Decision #6: one
  // audit row and one Socket.IO emit per broadcast batch, not one per
  // recipient).
  exports: [EVENT_PUBLISHER, REALTIME_BROADCASTER],
})
export class RealtimeModule {}
