import { Inject, Injectable, Logger } from '@nestjs/common';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  ID_GENERATOR,
  EVENT_PUBLISHER,
  UNIT_OF_WORK,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import { TableNotFoundException } from '@modules/tables/domain/exceptions/table-not-found.exception';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableMergeService } from '@modules/tables/domain/services/table-merge.service';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationAvailabilityService } from '@modules/reservations/domain/services/reservation-availability.service';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import { ReservationCreatedEvent } from '@modules/reservations/domain/events/reservation.events';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistSlotService } from '../../domain/services/waitlist-slot.service';
import { WaitlistEntryPromotedEvent } from '../../domain/events/waitlist.events';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '../../domain/repositories/reservation-waitlist-entry.repository';
import {
  WaitlistExpirationSchedulerPort,
  WAITLIST_EXPIRATION_SCHEDULER,
} from '../ports/waitlist-expiration-scheduler.port';
import { ScheduleApprovedReservationSignalsService } from '@modules/reservations/application/services/schedule-approved-reservation-signals.service';

export interface PromotionAttemptParams {
  entry: ReservationWaitlistEntry;
  branchTimezone: string;
  reservationIntervalMinutes: number;
  defaultReservationDurationMinutes: number;
  autoApproval: boolean;
  /** Employee id for manual promotion, `null` for automatic/System
   *  promotion (Phase 7.5 freeze item 16). */
  promotedBy: string | null;
  now: Date;
  correlationId?: string;
}

export type PromotionOutcome =
  | { promoted: true; reservationId: string }
  | { promoted: false; reason: 'not-serviceable' | 'lost-claim-race' };

/**
 * Phase 7.5 architecture freeze items 10/11/12, refined by the final
 * promotion-slot-semantics decision (2026-07-24). Owns conversion end to
 * end: derives the entry's own requested slot, searches for a currently
 * available Table (informational search, reusing
 * `SearchAvailabilityUseCase`'s exact building blocks - never the triggering
 * Reservation's own `tableId`), then performs the frozen atomic
 * claim -> ADR-013 lock -> create -> Table.reserve() -> Converted
 * transaction. Reuses `ReservationRepository.createWithLockInTransaction`
 * directly (never `CreateReservationUseCase` - freeze item 10). Called by
 * both `PromoteWaitlistEntryUseCase` (manual, one specific entry) and
 * `RecheckWaitlistUseCase` (automatic, scanning FIFO order) - one code path,
 * no divergence between the two triggers beyond `promotedBy`.
 */
@Injectable()
export class WaitlistPromotionService {
  private readonly logger = new Logger(WaitlistPromotionService.name);

  constructor(
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(WAITLIST_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: WaitlistExpirationSchedulerPort,
    private readonly scheduleApprovedReservationSignals: ScheduleApprovedReservationSignalsService,
  ) {}

  async attemptPromotion(params: PromotionAttemptParams): Promise<PromotionOutcome> {
    const { entry } = params;

    const { reservationStartTime, reservationEndTime } =
      WaitlistSlotService.deriveReservationWindow(
        entry.preferredDate,
        entry.preferredTimeFrom,
        params.branchTimezone,
        params.defaultReservationDurationMinutes,
      );

    if (reservationStartTime.getTime() <= params.now.getTime()) {
      // Phase 7.5 freeze item 5 / final decision: an entry whose requested
      // time has already passed is left alone - never reinterpreted as
      // "seat now". Its own expiration lifecycle remains authoritative.
      return { promoted: false, reason: 'not-serviceable' };
    }

    const table = await this.selectTable(entry, reservationStartTime, reservationEndTime);
    if (table === null) {
      return { promoted: false, reason: 'not-serviceable' };
    }

    const reservationId = this.idGenerator.generate();
    let claimApplied = false;
    let approvedReservation: Reservation | null = null;

    try {
      await this.unitOfWork.execute(async () => {
        // ADR-026 decision #7 "Compatibility with ADR-013/023": the
        // topology lock is acquired first, before the two-phase claim and
        // ADR-013's own slot lock below - a concurrent Merge/Split on this
        // table can never race a Waitlist promotion.
        await this.tableRepository.acquireTopologyLocks([table.tableId.value]);

        // Phase 1 of the two-phase claim: status-only, deliberately NOT
        // `convertedReservationId` yet - the target Reservation row does not
        // exist in the database until the insert below, and that column is
        // FK-constrained to `reservations.id` (a not-yet-existing id would
        // violate the FK). This status flip alone is the actual "only one
        // concurrent attempt wins" gate - phase 2 below only ever finalizes
        // a claim this phase already won.
        claimApplied = await this.waitlistRepository.claimStatusOnly(
          entry.entryId,
          WaitlistStatus.Converted,
          entry.status,
          params.now,
        );
        if (!claimApplied) {
          // Nothing was written (the conditional UPDATE matched zero rows) -
          // no rollback needed, just stop here.
          return;
        }

        // ADR-026 decision #4/#14: same effective-capacity resolution as
        // `CreateReservationUseCase` - `selectTable` only ever returns an
        // `Available` table, so a `mergeGroupId` here always means this
        // table is the group's Primary.
        const tableCapacity =
          table.mergeGroupId !== null
            ? TableMergeService.computeEffectiveCapacity(
                await this.tableRepository.findManyByMergeGroupId(table.mergeGroupId),
              )
            : table.capacity;

        const reservationProps = {
          id: reservationId,
          userId: entry.userId?.value ?? null,
          reservationGuestId: entry.reservationGuestId,
          source: ReservationSource.WaitlistConversion,
          restaurantId: entry.restaurantId.value,
          branchId: entry.branchId.value,
          tableId: table.tableId.value,
          // The entry's own `preferredDate` (already the correct
          // branch-local calendar date) - not re-derived from
          // `reservationStartTime`'s UTC calendar date, which can differ by
          // one day near a timezone boundary.
          reservationDate: entry.preferredDate,
          reservationStartTime,
          reservationEndTime,
          guests: entry.partySize,
          tableCapacity,
          notes: null,
          createdBy: params.promotedBy,
          now: params.now,
        };

        const reservation = params.autoApproval
          ? Reservation.createAutoApproved(reservationProps)
          : Reservation.create(reservationProps);

        const timeSlotBucket = ReservationAvailabilityService.deriveTimeSlotBucket(
          reservationStartTime,
          params.reservationIntervalMinutes,
        );
        const lockKey = ReservationAvailabilityService.deriveLockKey(
          entry.branchId.value,
          table.tableId.value,
          entry.preferredDate,
          timeSlotBucket,
        );

        // ADR-013: the sole concurrency authority. May throw
        // ReservationConflictException if the table was taken between the
        // informational search above and this transactional re-check -
        // rolls back the claim too (same transaction), restoring the entry
        // to its pre-attempt state (freeze item 12).
        await this.reservationRepository.createWithLockInTransaction(reservation, lockKey);

        if (params.autoApproval) {
          const tableToReserve = await this.tableRepository.findById(table.tableId);
          if (tableToReserve === null) {
            throw new TableNotFoundException();
          }
          const reservedTable = tableToReserve.reserve(reservationId, params.now);
          await this.tableRepository.save(reservedTable);
          // Phase 7.6 (Operational Signals, ADR-019): captured here (inside
          // the transaction closure, where `reservation` is in scope) but
          // only scheduled after the transaction commits below - mirrors
          // `CreateReservationUseCase`'s own auto-approve branch.
          approvedReservation = reservation;
        }

        // Phase 2 of the two-phase claim: the Reservation row now exists
        // (inserted above, same transaction), so this is safe to write.
        // Guarded by the `Converted` status phase 1 already set - this
        // transaction is the only writer that could have set it, so this
        // always applies; a `false` here would indicate an impossible state,
        // not a normal race outcome, hence the explicit throw rather than a
        // silent `lost-claim-race`.
        const claimedEntry = entry.convert(reservationId, params.now);
        const finalized = await this.waitlistRepository.updateTransitioningFrom(
          claimedEntry,
          WaitlistStatus.Converted,
        );
        if (!finalized) {
          throw new Error(
            `Waitlist entry "${entry.entryId}" was claimed but could not be finalized - unexpected concurrent state change within a single transaction.`,
          );
        }
      });
    } catch (error) {
      if (
        error instanceof ReservationConflictException ||
        error instanceof TableNotFoundException
      ) {
        // A genuine concurrency loss, not a bug - the whole transaction
        // (including the claim) has already rolled back. Safe to report as
        // a normal "could not promote this attempt" outcome.
        return { promoted: false, reason: 'lost-claim-race' };
      }
      throw error;
    }

    if (!claimApplied) {
      return { promoted: false, reason: 'lost-claim-race' };
    }

    // Best-effort cleanup only, mirroring `NotifyingEventPublisher.dispatchSafely`/
    // `RealtimeEventPublisher.broadcastSafely`: the promotion already committed
    // successfully above, so a transient scheduler/Redis failure here must
    // never surface as a 500 for an already-successful command. A stale
    // expiration job that still fires is a safe no-op (`ExpireWaitlistEntryUseCase`
    // only acts on entries still in Waiting/Notified).
    try {
      await this.expirationScheduler.cancelExpiration(entry.entryId);
    } catch (error) {
      this.logger.error(
        `Failed to cancel expiration job for promoted waitlist entry "${entry.entryId}": ${(error as Error).message}`,
        (error as Error).stack,
      );
    }

    if (approvedReservation !== null) {
      await this.scheduleApprovedReservationSignals.scheduleForApproved(
        approvedReservation,
        params.correlationId,
      );
    }

    await this.eventPublisher.publish(
      new WaitlistEntryPromotedEvent(
        this.idGenerator.generate(),
        {
          entryId: entry.entryId,
          restaurantId: entry.restaurantId.value,
          branchId: entry.branchId.value,
          convertedReservationId: reservationId,
          promotedBy: params.promotedBy,
        },
        params.now,
        params.correlationId,
      ),
    );
    await this.eventPublisher.publish(
      new ReservationCreatedEvent(
        this.idGenerator.generate(),
        {
          reservationId,
          restaurantId: entry.restaurantId.value,
          branchId: entry.branchId.value,
          tableId: table.tableId.value,
          userId: entry.userId?.value ?? null,
          reservationGuestId: entry.reservationGuestId,
          source: ReservationSource.WaitlistConversion,
          createdBy: params.promotedBy,
        },
        params.now,
        params.correlationId,
      ),
    );

    return { promoted: true, reservationId };
  }

  /**
   * Reuses `SearchAvailabilityUseCase`'s exact two building blocks
   * (`findManyAvailableByBranchIdAndMinCapacity` +
   * `findOverlappingPendingOrApprovedForTables`) - informational only,
   * ADR-013 remains the transactional authority (Phase 7.5 final decision
   * item 3). Deterministic selection: smallest sufficient capacity first,
   * `tableNumber` ascending as tie-break (the repository's own existing
   * default order, reused unmodified as the tie-break - final decision item
   * 4/5). The overlap check is batched into one query for every candidate
   * (not one round-trip per table) - `RecheckWaitlistUseCase` calls this once
   * per waiting entry, so an unbatched per-table loop here would multiply
   * into `O(waiting entries x available tables)` queries per job run.
   */
  private async selectTable(
    entry: ReservationWaitlistEntry,
    reservationStartTime: Date,
    reservationEndTime: Date,
  ): Promise<Table | null> {
    const candidates = await this.tableRepository.findManyAvailableByBranchIdAndMinCapacity(
      entry.branchId,
      entry.partySize,
    );

    const overlappingReservations =
      await this.reservationRepository.findOverlappingPendingOrApprovedForTables(
        candidates.map((table) => table.tableId),
        reservationStartTime,
        reservationEndTime,
      );
    const tableIdsWithOverlap = new Set(
      overlappingReservations.map((reservation) => reservation.tableId.value),
    );
    const serviceable = candidates.filter(
      (table) => !tableIdsWithOverlap.has(table.tableId.value),
    );

    if (serviceable.length === 0) {
      return null;
    }

    serviceable.sort(
      (a, b) => a.capacity - b.capacity || a.tableNumber.localeCompare(b.tableNumber),
    );
    return serviceable[0];
  }
}
