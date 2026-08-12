import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { TablesModule } from '@modules/tables/tables.module';
import { ReservationsModule } from '@modules/reservations/reservations.module';
import { CustomerAcquisitionModule } from '@modules/customer-acquisition/customer-acquisition.module';
import { WAITLIST_RECHECK_QUEUE_NAME } from '@shared/infrastructure/bullmq/waitlist-recheck-queue.constants';
import { JoinWaitlistUseCase } from './application/use-cases/join-waitlist.use-case';
import { CancelWaitlistEntryUseCase } from './application/use-cases/cancel-waitlist-entry.use-case';
import { PromoteWaitlistEntryUseCase } from './application/use-cases/promote-waitlist-entry.use-case';
import { ExpireWaitlistEntryUseCase } from './application/use-cases/expire-waitlist-entry.use-case';
import { RecheckWaitlistUseCase } from './application/use-cases/recheck-waitlist.use-case';
import { WaitlistPromotionService } from './application/services/waitlist-promotion.service';
import { RESERVATION_WAITLIST_ENTRY_REPOSITORY } from './domain/repositories/reservation-waitlist-entry.repository';
import { WAITLIST_EXPIRATION_SCHEDULER } from './application/ports/waitlist-expiration-scheduler.port';
import { PrismaReservationWaitlistEntryRepository } from './infrastructure/persistence/prisma-reservation-waitlist-entry.repository';
import { WAITLIST_QUEUE_NAME } from './infrastructure/bullmq/waitlist-queue.constants';
import { BullMqWaitlistExpirationScheduler } from './infrastructure/bullmq/waitlist-expiration.scheduler';
import { ExpireWaitlistEntryProcessor } from './infrastructure/bullmq/expire-waitlist-entry.processor';
import { WaitlistRecheckProcessor } from './infrastructure/bullmq/waitlist-recheck.processor';
import { WaitlistController } from './presentation/controllers/waitlist.controller';

/**
 * Phase 7.5 (Reservation Waitlist, ADR-019, architecture frozen 2026-07-24).
 * Imports `ReservationsModule` for `RESERVATION_REPOSITORY` (reused directly
 * by `WaitlistPromotionService` - freeze item 10, never
 * `CreateReservationUseCase`) and `RESERVATION_GUEST_REPOSITORY` (reused by
 * `JoinWaitlistUseCase`'s Employee-on-behalf-of-guest path). This is a
 * one-directional import only - `ReservationsModule` does NOT import this
 * module back; the automatic-recheck trigger (Blocker B resolution) is wired
 * via two independent BullMQ producer/consumer registrations of the same
 * named queue (`WaitlistRecheckQueue`, registered here for the consumer side
 * and in `ReservationsModule` for the producer side - see
 * `WAITLIST_RECHECK_QUEUE_NAME`'s own doc comment), not a circular module
 * dependency. `RestaurantsModule`/`BranchesModule`/`TablesModule` provide
 * `RESTAURANT_SETTINGS_REPOSITORY`/`BRANCH_REPOSITORY`/`TABLE_REPOSITORY` -
 * none of `ReservationWaitlistEntry`/`Branch`/`Table`/`RestaurantSettings`
 * are in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (Phase 7.5
 * tenancy correction, 2026-07-24: a direct `organizationId` column was found
 * incompatible with Customer-facing Join and removed), so every dependency
 * here is a safe read for a Customer actor with no bound `TenantContext`.
 *
 * Phase 7.6 (Operational Signals, ADR-019): `WaitlistPromotionService`'s
 * auto-approval branch also injects `ScheduleApprovedReservationSignalsService`
 * (exported by the already-imported `ReservationsModule`) to schedule the
 * Reminder/Late-Arrival jobs for a newly-Approved promoted reservation - no
 * new import or provider needed here.
 */
@Module({
  imports: [
    // Phase 19.8 (Owner Invite, ADR-036) correction: forwardRef - see
    // branches.module.ts's matching fix for the exact boot-time symptom.
    forwardRef(() => AuthenticationModule),
    AuthorizationModule,
    RestaurantsModule,
    BranchesModule,
    TablesModule,
    ReservationsModule,
    // Phase 19.2 (ADR-033): WaitlistPromotionService's auto-approval branch
    // also records a Customer Acquisition, exactly like
    // CreateReservationUseCase's own auto-approve branch (same shared
    // service, imported one-directionally - CustomerAcquisitionModule never
    // imports WaitlistModule back).
    CustomerAcquisitionModule,
    BullModule.registerQueue({ name: WAITLIST_QUEUE_NAME }),
    BullModule.registerQueue({ name: WAITLIST_RECHECK_QUEUE_NAME }),
  ],
  controllers: [WaitlistController],
  providers: [
    JoinWaitlistUseCase,
    CancelWaitlistEntryUseCase,
    PromoteWaitlistEntryUseCase,
    ExpireWaitlistEntryUseCase,
    RecheckWaitlistUseCase,
    WaitlistPromotionService,
    ExpireWaitlistEntryProcessor,
    WaitlistRecheckProcessor,
    PrismaReservationWaitlistEntryRepository,
    {
      provide: RESERVATION_WAITLIST_ENTRY_REPOSITORY,
      useExisting: PrismaReservationWaitlistEntryRepository,
    },
    BullMqWaitlistExpirationScheduler,
    { provide: WAITLIST_EXPIRATION_SCHEDULER, useExisting: BullMqWaitlistExpirationScheduler },
  ],
  // Phase 9 (architecture frozen 2026-07-25): RESERVATION_WAITLIST_ENTRY_REPOSITORY
  // is exported so NotificationsModule (which imports this module,
  // one-directionally - WaitlistModule never imports NotificationsModule
  // back) can resolve a promoted entry's recipient User and activate
  // WaitlistEntryNotified after push acceptance (decision item 7).
  //
  // Phase 20.X: CancelWaitlistEntryUseCase is additionally exported so
  // UsersModule's RequestAccountDeletionUseCase can reuse it verbatim for
  // the auto-cancel-active-waitlist-entries-on-delete step, rather than
  // re-deriving its CAS/event/scheduler-cancellation logic inline -
  // WaitlistModule never imports UsersModule back (one-directional, same
  // shape as the NotificationsModule relationship above).
  exports: [RESERVATION_WAITLIST_ENTRY_REPOSITORY, CancelWaitlistEntryUseCase],
})
export class WaitlistModule {}
