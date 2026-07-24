import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { TablesModule } from '@modules/tables/tables.module';
import { SearchAvailabilityUseCase } from './application/use-cases/search-availability.use-case';
import { CreateReservationUseCase } from './application/use-cases/create-reservation.use-case';
import { ApproveReservationUseCase } from './application/use-cases/approve-reservation.use-case';
import { RejectReservationUseCase } from './application/use-cases/reject-reservation.use-case';
import { CancelReservationUseCase } from './application/use-cases/cancel-reservation.use-case';
import { RescheduleReservationUseCase } from './application/use-cases/reschedule-reservation.use-case';
import { CompleteReservationUseCase } from './application/use-cases/complete-reservation.use-case';
import { MarkNoShowReservationUseCase } from './application/use-cases/mark-no-show-reservation.use-case';
import { ExpirePendingReservationUseCase } from './application/use-cases/expire-pending-reservation.use-case';
import { AutoRejectOverlappingPendingReservationsService } from './application/services/auto-reject-overlapping-pending-reservations.service';
import { RESERVATION_REPOSITORY } from './domain/repositories/reservation.repository';
import { RESERVATION_HISTORY_REPOSITORY } from './domain/repositories/reservation-history.repository';
import { RESERVATION_GUEST_REPOSITORY } from './domain/repositories/reservation-guest.repository';
import { RESERVATION_EXPIRATION_SCHEDULER } from './application/ports/reservation-expiration-scheduler.port';
import { PrismaReservationRepository } from './infrastructure/persistence/prisma-reservation.repository';
import { PrismaReservationHistoryRepository } from './infrastructure/persistence/prisma-reservation-history.repository';
import { PrismaReservationGuestRepository } from './infrastructure/persistence/prisma-reservation-guest.repository';
import { RESERVATION_QUEUE_NAME } from './infrastructure/bullmq/reservation-queue.constants';
import { BullMqReservationExpirationScheduler } from './infrastructure/bullmq/reservation-expiration.scheduler';
import { ExpireReservationProcessor } from './infrastructure/bullmq/expire-reservation.processor';
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
 * further import of that module).
 *
 * Depends on `RestaurantsModule` for `RESTAURANT_SETTINGS_REPOSITORY`
 * (`reservationEndTime` derivation, advisory-lock time-slot bucketing,
 * cancellation/reschedule window, pending-reservation timeout),
 * `BranchesModule` for `BRANCH_REPOSITORY`, and `TablesModule` for
 * `TABLE_REPOSITORY` - none of `Reservation`/`Branch`/`Table`/
 * `RestaurantSettings` are in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS`, so every dependency here is a safe read for
 * an actor with no `organizationId` (see each repository's own doc comment).
 * `AUDIT_LOG_WRITER`/`UNIT_OF_WORK` are not listed as imports -
 * `AuditModule` is `@Global()` and `UNIT_OF_WORK` is exported by the
 * already-imported `AuthenticationModule`.
 */
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    RestaurantsModule,
    BranchesModule,
    TablesModule,
    BullModule.registerQueue({ name: RESERVATION_QUEUE_NAME }),
  ],
  controllers: [ReservationsController],
  providers: [
    SearchAvailabilityUseCase,
    CreateReservationUseCase,
    ApproveReservationUseCase,
    RejectReservationUseCase,
    CancelReservationUseCase,
    RescheduleReservationUseCase,
    CompleteReservationUseCase,
    MarkNoShowReservationUseCase,
    ExpirePendingReservationUseCase,
    AutoRejectOverlappingPendingReservationsService,
    ExpireReservationProcessor,
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
  ],
})
export class ReservationsModule {}
