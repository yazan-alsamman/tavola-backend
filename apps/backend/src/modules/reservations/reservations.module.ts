import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { TablesModule } from '@modules/tables/tables.module';
import { WAITLIST_RECHECK_QUEUE_NAME } from '@shared/infrastructure/bullmq/waitlist-recheck-queue.constants';
import { SearchAvailabilityUseCase } from './application/use-cases/search-availability.use-case';
import { CreateReservationUseCase } from './application/use-cases/create-reservation.use-case';
import { ListMyReservationsUseCase } from './application/use-cases/list-my-reservations.use-case';
import { GetMyReservationUseCase } from './application/use-cases/get-my-reservation.use-case';
import { ApproveReservationUseCase } from './application/use-cases/approve-reservation.use-case';
import { RejectReservationUseCase } from './application/use-cases/reject-reservation.use-case';
import { CancelReservationUseCase } from './application/use-cases/cancel-reservation.use-case';
import { RescheduleReservationUseCase } from './application/use-cases/reschedule-reservation.use-case';
import { CompleteReservationUseCase } from './application/use-cases/complete-reservation.use-case';
import { MarkNoShowReservationUseCase } from './application/use-cases/mark-no-show-reservation.use-case';
import { MarkTableReadyReservationUseCase } from './application/use-cases/mark-table-ready-reservation.use-case';
import { ExpirePendingReservationUseCase } from './application/use-cases/expire-pending-reservation.use-case';
import { PublishReservationReminderUseCase } from './application/use-cases/publish-reservation-reminder.use-case';
import { ProcessLateArrivalUseCase } from './application/use-cases/process-late-arrival.use-case';
import { AutoRejectOverlappingPendingReservationsService } from './application/services/auto-reject-overlapping-pending-reservations.service';
import { ScheduleApprovedReservationSignalsService } from './application/services/schedule-approved-reservation-signals.service';
import { RESERVATION_REPOSITORY } from './domain/repositories/reservation.repository';
import { RESERVATION_HISTORY_REPOSITORY } from './domain/repositories/reservation-history.repository';
import { RESERVATION_GUEST_REPOSITORY } from './domain/repositories/reservation-guest.repository';
import { RESERVATION_EXPIRATION_SCHEDULER } from './application/ports/reservation-expiration-scheduler.port';
import { WAITLIST_RECHECK_SCHEDULER } from './application/ports/waitlist-recheck-scheduler.port';
import { APPROVED_RESERVATION_OPERATIONAL_SCHEDULER } from './application/ports/approved-reservation-operational-scheduler.port';
import { PrismaReservationRepository } from './infrastructure/persistence/prisma-reservation.repository';
import { PrismaReservationHistoryRepository } from './infrastructure/persistence/prisma-reservation-history.repository';
import { PrismaReservationGuestRepository } from './infrastructure/persistence/prisma-reservation-guest.repository';
import { RESERVATION_QUEUE_NAME } from './infrastructure/bullmq/reservation-queue.constants';
import { REMINDER_QUEUE_NAME } from './infrastructure/bullmq/reminder-queue.constants';
import { LATE_ARRIVAL_QUEUE_NAME } from './infrastructure/bullmq/late-arrival-queue.constants';
import { BullMqReservationExpirationScheduler } from './infrastructure/bullmq/reservation-expiration.scheduler';
import { ExpireReservationProcessor } from './infrastructure/bullmq/expire-reservation.processor';
import { BullMqWaitlistRecheckScheduler } from './infrastructure/bullmq/waitlist-recheck.scheduler';
import { BullMqApprovedReservationOperationalScheduler } from './infrastructure/bullmq/approved-reservation-operational.scheduler';
import { ReservationReminderProcessor } from './infrastructure/bullmq/reservation-reminder.processor';
import { LateArrivalProcessor } from './infrastructure/bullmq/late-arrival.processor';
import { ReservationsController } from './presentation/controllers/reservations.controller';

/**
 * Phase 7.1 (Reservation Core): Search Availability + Create Reservation,
 * customer-facing (`JwtAuthGuard`/`SessionVersionGuard` only, no
 * organization/employee guard - see `ReservationsController`'s own doc
 * comment). Phase 7.2 (Approval Workflow) adds Approve/Reject, staff-facing
 * (`PermissionsGuard` + `reservations:approve`, Employee actor only) - hence
 * the `AuthorizationModule` import (exports `PermissionsGuard`). Phase 7.3
 * (Reservation Lifecycle) adds Cancel/Reschedule (dual-actor: Customer
 * ownership or Employee `reservations:cancel`/`reservations:reschedule`, no
 * `PermissionsGuard` at the route level - resolved inside the use cases),
 * Complete/No-Show (Employee-only, `reservations:complete`/
 * `reservations:noshow`, same pattern as Approve/Reject), and the
 * BullMQ-driven Pending-expiration job - hence `BullModule.registerQueue`
 * (the shared connection is already registered globally by the top-level
 * `QueueModule`, imported once in `AppModule` - `@nestjs/bullmq`'s
 * `forRootAsync` registration is global, so `registerQueue` here needs no
 * further import of that module). Phase 7.5 (Reservation Waitlist) adds a
 * second `BullModule.registerQueue` for `WaitlistRecheckQueue` - this
 * module is that queue's PRODUCER (`BullMqWaitlistRecheckScheduler`,
 * injected into `CancelReservationUseCase`'s `Approved -> Cancelled` branch
 * and `MarkNoShowReservationUseCase`), while `WaitlistModule` independently
 * registers the same queue name as its own CONSUMER - two ordinary BullMQ
 * producer/consumer registrations of one shared queue, not a circular
 * module import (see `WAITLIST_RECHECK_QUEUE_NAME`'s own doc comment).
 * `RESERVATION_REPOSITORY`/`RESERVATION_GUEST_REPOSITORY` are exported so
 * `WaitlistModule` (which imports this module) can reuse the low-level
 * Reservation creation/concurrency infrastructure directly (Phase 7.5 freeze
 * item 10) - `WaitlistModule` is never imported back here.
 *
 * Depends on `RestaurantsModule` for `RESTAURANT_SETTINGS_REPOSITORY`
 * (`reservationEndTime` derivation, advisory-lock time-slot bucketing,
 * cancellation/reschedule window, pending-reservation timeout),
 * `BranchesModule` for `BRANCH_REPOSITORY`, and `TablesModule` (via
 * `forwardRef` - see below) for `TABLE_REPOSITORY` - none of
 * `Reservation`/`Branch`/`Table`/`RestaurantSettings` are in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`, so every dependency
 * here is a safe read for an actor with no `organizationId` (see each
 * repository's own doc comment). `AUDIT_LOG_WRITER`/`UNIT_OF_WORK` are not
 * listed as imports - `AuditModule` is `@Global()` and `UNIT_OF_WORK` is
 * exported by the already-imported `AuthenticationModule`.
 *
 * Phase 7.6 (Operational Signals, ADR-019) adds two more dedicated BullMQ
 * queues (`ReminderQueue`/`LateArrivalQueue`, each its own
 * `BullModule.registerQueue`, mirroring `ReservationQueue`'s own
 * one-queue-per-concern precedent), their processors, and
 * `BullMqApprovedReservationOperationalScheduler` (bound to
 * `APPROVED_RESERVATION_OPERATIONAL_SCHEDULER`). Both the scheduler token and
 * `ScheduleApprovedReservationSignalsService` are exported so `WaitlistModule`
 * (already importing this module for Phase 7.5) can schedule the same two
 * signals from `WaitlistPromotionService`'s own auto-approval branch, without
 * duplicating the `RestaurantSettings` lookup-with-fallback logic. Adds the
 * staff-only Table Ready endpoint (`reservations:tableready`,
 * `MarkTableReadyReservationUseCase`) alongside Complete/No-Show.
 */
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    RestaurantsModule,
    // `forwardRef` (Phase 6, ADR-026): this module has no DIRECT edge back to
    // `BranchesModule`, but adding `forwardRef(() => ReservationsModule)` to
    // `TablesModule` below closes a genuine 3-module cycle at the Node/CommonJS
    // require level - `AppModule` requires `BranchesModule` first, which
    // requires `TablesModule`, which requires THIS file, which (transitively,
    // via the plain `BranchesModule` import at the top of this file) would
    // try to `require('branches.module.ts')` again while it is still
    // mid-execution higher up the same call stack, at which point its
    // `BranchesModule` class binding does not exist yet (`undefined`) - this
    // import must be deferred with `forwardRef` too, exactly like the two
    // genuine two-module edges below, or Nest fails with "the module at index
    // [n] of the ReservationsModule imports array is undefined."
    forwardRef(() => BranchesModule),
    // `forwardRef` (Phase 6, ADR-026): `TablesModule` itself now imports
    // `forwardRef(() => ReservationsModule)` for `RESERVATION_REPOSITORY`
    // (Merge/Split Tables' reservation-blocking check) - a genuine circular
    // dependency between the two feature modules, resolved with Nest's
    // standard `forwardRef` mechanism on both sides, exactly like the
    // pre-existing `BranchesModule` <-> `TablesModule` edge.
    forwardRef(() => TablesModule),
    BullModule.registerQueue({ name: RESERVATION_QUEUE_NAME }),
    BullModule.registerQueue({ name: WAITLIST_RECHECK_QUEUE_NAME }),
    BullModule.registerQueue({ name: REMINDER_QUEUE_NAME }),
    BullModule.registerQueue({ name: LATE_ARRIVAL_QUEUE_NAME }),
  ],
  controllers: [ReservationsController],
  providers: [
    SearchAvailabilityUseCase,
    CreateReservationUseCase,
    ListMyReservationsUseCase,
    GetMyReservationUseCase,
    ApproveReservationUseCase,
    RejectReservationUseCase,
    CancelReservationUseCase,
    RescheduleReservationUseCase,
    CompleteReservationUseCase,
    MarkNoShowReservationUseCase,
    MarkTableReadyReservationUseCase,
    ExpirePendingReservationUseCase,
    PublishReservationReminderUseCase,
    ProcessLateArrivalUseCase,
    AutoRejectOverlappingPendingReservationsService,
    ScheduleApprovedReservationSignalsService,
    ExpireReservationProcessor,
    ReservationReminderProcessor,
    LateArrivalProcessor,
    PrismaReservationRepository,
    { provide: RESERVATION_REPOSITORY, useExisting: PrismaReservationRepository },
    PrismaReservationHistoryRepository,
    { provide: RESERVATION_HISTORY_REPOSITORY, useExisting: PrismaReservationHistoryRepository },
    PrismaReservationGuestRepository,
    { provide: RESERVATION_GUEST_REPOSITORY, useExisting: PrismaReservationGuestRepository },
    BullMqReservationExpirationScheduler,
    {
      provide: RESERVATION_EXPIRATION_SCHEDULER,
      useExisting: BullMqReservationExpirationScheduler,
    },
    BullMqWaitlistRecheckScheduler,
    { provide: WAITLIST_RECHECK_SCHEDULER, useExisting: BullMqWaitlistRecheckScheduler },
    BullMqApprovedReservationOperationalScheduler,
    {
      provide: APPROVED_RESERVATION_OPERATIONAL_SCHEDULER,
      useExisting: BullMqApprovedReservationOperationalScheduler,
    },
  ],
  exports: [
    RESERVATION_REPOSITORY,
    RESERVATION_GUEST_REPOSITORY,
    APPROVED_RESERVATION_OPERATIONAL_SCHEDULER,
    ScheduleApprovedReservationSignalsService,
  ],
})
export class ReservationsModule {}
