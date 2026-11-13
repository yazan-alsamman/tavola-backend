import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { BranchId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import { TableNotFoundException } from '@modules/tables/domain/exceptions/table-not-found.exception';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import { TableMergeService } from '@modules/tables/domain/services/table-merge.service';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationGuest } from '../../domain/entities/reservation-guest.entity';
import { ReservationSource } from '../../domain/enums/reservation.enums';
import { ReservationAvailabilityService } from '../../domain/services/reservation-availability.service';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { InvalidReservationException } from '../../domain/exceptions/invalid-reservation.exception';
import { TableUnavailableException } from '../../domain/exceptions/table-unavailable.exception';
import { ReservationCreatedEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import {
  ReservationGuestRepository,
  RESERVATION_GUEST_REPOSITORY,
} from '../../domain/repositories/reservation-guest.repository';
import { assertEmployeeCanCreateReservation } from '../services/assert-employee-reservation-scope';
import {
  ReservationExpirationSchedulerPort,
  RESERVATION_EXPIRATION_SCHEDULER,
} from '../ports/reservation-expiration-scheduler.port';
import { ScheduleApprovedReservationSignalsService } from '../services/schedule-approved-reservation-signals.service';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { CreateReservationCommand } from '../dto/create-reservation.command';
import { ReservationResult } from '../dto/reservation.result';
import {
  BookingEligibilityReaderPort,
  BOOKING_ELIGIBILITY_READER,
} from '../ports/booking-eligibility-reader.port';
import { BranchOpeningHoursService } from '../services/branch-opening-hours.service';
import {
  durationMinutes,
  fitsDailyGuestCap,
  fitsOpeningHours,
  isWithinBookingHorizon,
  lastBookableDate,
  localDayBounds,
  MAX_ONLINE_BOOKING_ADVANCE_DAYS,
  meetsMinLeadTime,
  MAX_RESERVATION_DURATION_MINUTES,
  MAX_UPCOMING_ONLINE_RESERVATIONS_PER_CUSTOMER,
  MIN_RESERVATION_DURATION_MINUTES,
} from '../../domain/services/reservation-booking-policy';
import { calendarDateInTimeZone } from '../../domain/services/reservation-time-slots.service';
import { ActiveReservationLimitReachedException } from '../../domain/exceptions/active-reservation-limit-reached.exception';
import { RestaurantNotAcceptingReservationsException } from '../../domain/exceptions/restaurant-not-accepting-reservations.exception';
import { RecordCustomerAcquisitionOnApprovalService } from '@modules/customer-acquisition/application/services/record-customer-acquisition-on-approval.service';
import { RecordAcquisitionOnApprovalResult } from '@modules/customer-acquisition/application/dto/record-acquisition-on-approval.command';
import { CustomerAcquisitionRecordedEvent } from '@modules/customer-acquisition/domain/events/customer-acquisition.events';
import {
  OFFER_ATTRIBUTION_READER,
  OfferAttributionReaderPort,
} from '../ports/offer-attribution-reader.port';

/**
 * Phase 7.4 decision #3's authorization matrix, resolved once up front
 * before any repository call. `Online` is reachable by **any** authenticated
 * actor type, unchanged from Phase 7.1's own frozen behavior ("Customer-facing
 * (any authenticated actor type... - no organization/branch-scope guard",
 * `CreateReservationUseCase`'s original doc comment) - this is the
 * "already-frozen architecture rule" decision #3 itself names as the one
 * exception to "Employee + Online -> forbidden": an Employee (or
 * OrganizationMember) booking Online for themselves, attributed to their own
 * `userId`, is unchanged self-service booking, not a staff-on-behalf-of-guest
 * action, and Phase 7.4 must not narrow it (binding clarification: "preserve
 * existing Customer Online reservation behavior"). `Phone`/`WalkIn` remain
 * reachable only by an `Employee` actor, subject to
 * `assertEmployeeCanCreateReservation`'s own branch-scope + `reservations:create`
 * check, run later once the Branch is resolved.
 */
function assertActorSourceIsReachable(actor: AuthenticatedActor, source: ReservationSource): void {
  const isStaffSource = source === ReservationSource.Phone || source === ReservationSource.WalkIn;
  if (!isStaffSource) {
    return;
  }

  if (actor.actorType !== AccessTokenActorType.Employee) {
    throw new PermissionDeniedException();
  }
}

/**
 * Phase 7.1 (TASKS.md Phase 7.1 Scope Amendment, 2026-07-20) produces a
 * `Pending` reservation when `RestaurantSettings.autoApproval` is falsy
 * (including unconfigured). Phase 7.2 completes the previously-deferred
 * auto-approval branch: when `autoApproval === true`, the reservation is
 * created directly as `Approved` (via `Reservation.createAutoApproved`,
 * never passing through `Pending`) and `Table.reserve()` is called in the
 * same ADR-013 advisory-locked transaction as the insert - one atomic unit,
 * via `UnitOfWorkPort` wrapping `ReservationRepository.createWithLockInTransaction`
 * (the same lock/conflict-check/insert core `createWithLock` itself uses,
 * just without its own transaction wrapper). No redundant `Pending ->
 * Approved` transition or event is emitted for this path (TASKS.md Phase 7
 * decision note item 2) - only `ReservationCreatedEvent` fires, exactly as
 * it does for the Pending path, since the reservation was never Pending to
 * begin with. Customer-facing (any authenticated actor type, matching
 * `UsersController`'s own-resource precedent) - no organization/branch-scope
 * guard.
 */
@Injectable()
export class CreateReservationUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_GUEST_REPOSITORY)
    private readonly reservationGuestRepository: ReservationGuestRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(RESERVATION_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: ReservationExpirationSchedulerPort,
    private readonly scheduleApprovedReservationSignals: ScheduleApprovedReservationSignalsService,
    private readonly recordCustomerAcquisitionOnApproval: RecordCustomerAcquisitionOnApprovalService,
    @Inject(OFFER_ATTRIBUTION_READER)
    private readonly offerAttributionReader: OfferAttributionReaderPort,
    @Inject(BOOKING_ELIGIBILITY_READER)
    private readonly bookingEligibility: BookingEligibilityReaderPort,
    private readonly openingHours: BranchOpeningHoursService,
  ) {}

  async execute(command: CreateReservationCommand): Promise<ReservationResult> {
    // Phase 7.4 binding clarification #1: `source` is resolved to a concrete
    // value here, at the presentation/application boundary - never left
    // undefined past this point.
    const source = command.source ?? ReservationSource.Online;
    assertActorSourceIsReachable(command.actor, source);

    const branchId = BranchId.create(command.branchId);
    const tableId = TableId.create(command.tableId);

    const branch = await this.branchRepository.findById(branchId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    // Branch-scope + reservations:create is only checked for the
    // staff-on-behalf-of-guest path (Phone/WalkIn). An Employee actor
    // creating source Online is self-booking, exactly like any other actor
    // type, and is not subject to this check (see assertActorSourceIsReachable's
    // own doc comment).
    const isStaffSource = source === ReservationSource.Phone || source === ReservationSource.WalkIn;
    if (isStaffSource && command.actor.actorType === AccessTokenActorType.Employee) {
      assertEmployeeCanCreateReservation(
        command.actor,
        branch.restaurantId,
        branchId,
        'reservations:create',
      );
    }

    const table = await this.tableRepository.findByIdAndBranchId(tableId, branchId);
    if (table === null) {
      throw new TableNotFoundException();
    }
    if (table.status !== TableStatus.Available) {
      throw new TableUnavailableException();
    }

    // Phase 6 (Merge/Split Tables, ADR-026 decision #4/#14): an `Available`
    // table with a `mergeGroupId` is necessarily the Primary (a secondary is
    // always `Merged`, already rejected above) - party-size/tableCapacity
    // validation must use the merge group's `effectiveCapacity`
    // (SUM of every member's permanent capacity), not just the primary's own
    // `capacity` column.
    const tableCapacity =
      table.mergeGroupId !== null
        ? TableMergeService.computeEffectiveCapacity(
            await this.tableRepository.findManyByMergeGroupId(table.mergeGroupId),
          )
        : table.capacity;

    const startTime = new Date(command.reservationStartTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new InvalidReservationTimeException('reservationStartTime is not a valid date-time.');
    }

    const settings = await this.restaurantSettingsRepository.findForBranch(
      branch.restaurantId,
      branch.branchId,
    );
    const endTime = this.resolveEndTime(startTime, command.reservationEndTime, settings);

    const now = this.clock.now();
    await this.assertBookable({
      restaurantId: branch.restaurantId.value,
      branchId: branchId.value,
      timeZone: branch.timezone,
      source,
      userId: command.actor.userId,
      startTime,
      endTime,
      guests: command.guests,
      maxGuests: settings?.maxGuestsPerReservation ?? null,
      limits: {
        paused: branch.isPaused(),
        minLeadTimeMinutes: settings?.minLeadTimeMinutes ?? 0,
        maxDaysAhead: settings?.maxDaysAhead ?? null,
        dailyGuestCap: settings?.dailyGuestCap ?? null,
      },
      now,
    });

    const reservationDate = new Date(
      Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate()),
    );

    const party = this.resolveParty(command, source, now);
    const offerId = command.offerId
      ? await this.offerAttributionReader.findAttributableOfferId(
          command.offerId,
          branch.restaurantId.value,
          now,
          {
            branchId: branchId.value,
            partySize: command.guests,
            startTime,
            timeZone: branch.timezone,
            userId: party.userId,
            guestPhone: party.guest?.phone ?? null,
          },
        )
      : null;

    const reservationProps = {
      id: this.idGenerator.generate(),
      userId: party.userId,
      reservationGuestId: party.reservationGuestId,
      source,
      restaurantId: branch.restaurantId.value,
      branchId: branchId.value,
      tableId: tableId.value,
      reservationDate,
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: command.guests,
      tableCapacity,
      notes: command.notes ?? null,
      createdBy: party.createdBy,
      offerId,
      now,
    };

    const reservationIntervalMinutes = settings?.reservationIntervalMinutes ?? 30;
    const timeSlotBucket = ReservationAvailabilityService.deriveTimeSlotBucket(
      startTime,
      reservationIntervalMinutes,
    );
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId.value,
      tableId.value,
      reservationDate,
      timeSlotBucket,
    );

    // ADR-053: auto-approval may stop above a party size.
    const autoApprove = settings?.autoApprovesParty(command.guests) === true;
    const reservation = autoApprove
      ? Reservation.createAutoApproved(reservationProps)
      : Reservation.create(reservationProps);

    let acquisitionResult: RecordAcquisitionOnApprovalResult = { recorded: false };

    if (autoApprove) {
      // TASKS.md Phase 7 decision note item 2 / item 6: Table.reserve() runs
      // in the SAME advisory-locked transaction as the insert - one atomic
      // unit. `createWithLockInTransaction` is the exact lock/conflict-check/
      // insert core `createWithLock` (the non-auto-approval path, below) uses
      // internally, reused here without its own transaction wrapper so the
      // Table update joins the same transaction. Phase 7.4 binding
      // clarification #2: `ReservationGuest` (Phone/WalkIn only) is
      // persisted inside this same transaction, before the reservation
      // insert - an ADR-013 conflict, validation failure, or Table.reserve()
      // failure rolls back the guest row too, never leaving it orphaned.
      await this.unitOfWork.execute(async () => {
        // ADR-026 decision #7 "Compatibility with ADR-013/023": the topology
        // lock (whether or not this table is actually merged) is acquired
        // FIRST, before any ADR-013 slot lock, in every transaction that may
        // read/write this Table row - preventing a concurrent Merge/Split
        // from changing `mergeGroupId`/`status` underneath this reservation.
        await this.tableRepository.acquireTopologyLocks([tableId.value]);

        if (party.guest !== null) {
          await this.reservationGuestRepository.save(party.guest);
        }

        await this.reservationRepository.createWithLockInTransaction(reservation, lockKey);

        const tableToReserve = await this.tableRepository.findById(tableId);
        if (tableToReserve === null) {
          throw new TableNotFoundException();
        }
        const reservedTable = tableToReserve.reserve(reservation.reservationId.value, now);
        await this.tableRepository.save(reservedTable);

        // ADR-033 §3/§13: a reservation born Approved directly (never
        // Pending) is still its first transition into Approved - recorded
        // inside this same transaction.
        acquisitionResult = await this.recordCustomerAcquisitionOnApproval.recordIfEligible({
          restaurantId: branch.restaurantId.value,
          branchId: branchId.value,
          userId: party.userId,
          reservationGuestId: party.reservationGuestId,
          source,
          sourceReservationId: reservation.reservationId.value,
          now,
          correlationId: command.correlationId,
        });
      });

      // Phase 7.6 (Operational Signals, ADR-019): an auto-approved
      // reservation is born Approved directly, never Pending - schedule the
      // Reminder/Late-Arrival BullMQ jobs now, not the Pending-expiration
      // job (that path is the `else` branch below, mutually exclusive with
      // this one). External I/O, so only after the transaction has
      // committed.
      await this.scheduleApprovedReservationSignals.scheduleForApproved(
        reservation,
        command.correlationId,
      );
    } else {
      // Phase 7.4 binding clarification #2: previously `createWithLock`
      // (which opens its own internal transaction) was called directly here.
      // `createWithLock` is defined as `runInTransaction(() =>
      // createWithLockInTransaction(...))` - byte-identical to wrapping
      // `createWithLockInTransaction` in `unitOfWork.execute` (both resolve
      // to the same `PrismaContext.runInTransaction`), so this preserves
      // ADR-013's lock/exclusion-constraint guarantees exactly while adding
      // room for the guest row to join the same atomic operation.
      await this.unitOfWork.execute(async () => {
        // ADR-026 decision #7: same topology-lock-before-slot-lock ordering
        // as the auto-approve branch above, even though a `Pending`
        // reservation never itself calls `Table.reserve()` - Merge/Split
        // must still never race a concurrent Create for this table.
        await this.tableRepository.acquireTopologyLocks([tableId.value]);

        if (party.guest !== null) {
          await this.reservationGuestRepository.save(party.guest);
        }

        await this.reservationRepository.createWithLockInTransaction(reservation, lockKey);
      });

      // Phase 7.3 (Reservation Lifecycle): schedule the Pending-expiration
      // BullMQ job only for the Pending path - an auto-approved reservation
      // is never Pending, so it never expires. Scheduled after the
      // transaction commits (CODING_STANDARDS.md's "no external I/O inside
      // the locked transaction" rule - queuing to Redis is external I/O).
      const pendingReservationTimeoutMinutes = settings?.pendingReservationTimeoutMinutes ?? 15;
      const expireAt = new Date(startTime.getTime() + pendingReservationTimeoutMinutes * 60_000);
      await this.expirationScheduler.scheduleExpiration(
        reservation.reservationId.value,
        null,
        expireAt,
        command.correlationId,
      );
    }

    await this.eventPublisher.publish(
      new ReservationCreatedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservation.reservationId.value,
          restaurantId: branch.restaurantId.value,
          branchId: branchId.value,
          tableId: tableId.value,
          userId: party.userId,
          reservationGuestId: party.reservationGuestId,
          source,
          createdBy: party.createdBy,
        },
        now,
        command.correlationId,
      ),
    );

    if (acquisitionResult.recorded) {
      await this.eventPublisher.publish(
        new CustomerAcquisitionRecordedEvent(
          this.idGenerator.generate(),
          {
            acquisitionId: acquisitionResult.acquisitionId!,
            restaurantId: branch.restaurantId.value,
            customerIdentityKey: acquisitionResult.customerIdentityKey!,
            feeAmount: acquisitionResult.feeAmount!,
            feeCurrency: acquisitionResult.feeCurrency!,
            pricingRuleId: acquisitionResult.pricingRuleId!,
            sourceReservationId: reservation.reservationId.value,
          },
          now,
          command.correlationId,
        ),
      );
    }

    return toReservationResult(reservation);
  }

  /**
   * Phase 7.4 decision #6: resolves the reservation-party fields and
   * `createdBy` from the actor + resolved source, never from client-supplied
   * identity fields. Online always uses the Customer's own `userId`
   * (unchanged Phase 7.1 behavior). Phone/WalkIn (Employee actor only, per
   * `assertActorSourceIsReachable`) builds a new `ReservationGuest` from
   * `command.reservationGuest` and attributes `createdBy` to the Employee's
   * own `employeeId` - the same `approvedBy`/`actor.employeeId` precedent
   * `ApproveReservationUseCase` already established, never the Employee's
   * own `userId`.
   */
  private resolveParty(
    command: CreateReservationCommand,
    source: ReservationSource,
    now: Date,
  ): {
    userId: string | null;
    reservationGuestId: string | null;
    createdBy: string;
    guest: ReservationGuest | null;
  } {
    if (source === ReservationSource.Online) {
      return {
        userId: command.actor.userId,
        reservationGuestId: null,
        createdBy: command.actor.userId,
        guest: null,
      };
    }

    if (command.actor.actorType !== AccessTokenActorType.Employee) {
      // Unreachable: assertActorSourceIsReachable already rejected any
      // non-Employee actor for a Phone/WalkIn source. Kept as a defensive
      // guard so this method never silently mis-attributes a reservation.
      throw new PermissionDeniedException();
    }

    if (!command.reservationGuest) {
      throw new InvalidReservationException(
        'reservationGuest is required when source is Phone or WalkIn.',
      );
    }

    const guest = ReservationGuest.create({
      id: this.idGenerator.generate(),
      fullName: command.reservationGuest.fullName,
      countryCode: command.reservationGuest.countryCode,
      phoneNumber: command.reservationGuest.phoneNumber,
      email: command.reservationGuest.email ?? null,
      now,
    });

    return {
      userId: null,
      reservationGuestId: guest.guestId,
      createdBy: command.actor.employeeId,
      guest,
    };
  }

  /**
   * Booking rules every reservation must satisfy before it can hold a table:
   * the restaurant is Active, and the duration is between 15 minutes and 8
   * hours. A customer's own Online booking must also fit the branch opening
   * hours, start within the next 90 days, respect the restaurant's party-size
   * maximum, and keep the customer under 5 upcoming reservations. Staff
   * Phone/WalkIn bookings may sit outside opening hours on purpose (a late
   * private event, for example), so those rules apply to Online only.
   */
  /** ADR-053: pause, temporary closures and the branch's extra booking limits. */
  private async assertWithinBranchLimits(input: {
    branchId: string;
    timeZone: string;
    startTime: Date;
    guests: number;
    limits: {
      paused: boolean;
      minLeadTimeMinutes: number;
      maxDaysAhead: number | null;
      dailyGuestCap: number | null;
    };
    now: Date;
  }): Promise<void> {
    if (input.limits.paused) {
      throw new RestaurantNotAcceptingReservationsException();
    }
    const localDate = calendarDateInTimeZone(input.startTime, input.timeZone);
    if (await this.openingHours.isClosedOn(input.branchId, localDate)) {
      throw new InvalidReservationTimeException('The branch is closed on this date.');
    }
    if (!meetsMinLeadTime(input.startTime, input.now, input.limits.minLeadTimeMinutes)) {
      throw new InvalidReservationTimeException(
        `Reservations must be made at least ${input.limits.minLeadTimeMinutes} minutes ahead.`,
      );
    }
    const today = calendarDateInTimeZone(input.now, input.timeZone);
    if (localDate > lastBookableDate(today, input.limits.maxDaysAhead)) {
      throw new InvalidReservationTimeException(
        `Reservations can be made at most ${input.limits.maxDaysAhead ?? MAX_ONLINE_BOOKING_ADVANCE_DAYS} days ahead.`,
      );
    }
    if (input.limits.dailyGuestCap !== null) {
      const day = localDayBounds(localDate, input.timeZone);
      const booked = await this.bookingEligibility.sumActiveGuestsForBranchBetween(
        input.branchId,
        day.start,
        day.end,
      );
      if (!fitsDailyGuestCap(booked, input.guests, input.limits.dailyGuestCap)) {
        throw new InvalidReservationException('The branch is fully booked on this date.');
      }
    }
  }

  private async assertBookable(input: {
    restaurantId: string;
    branchId: string;
    timeZone: string;
    source: ReservationSource;
    userId: string;
    startTime: Date;
    endTime: Date;
    guests: number;
    maxGuests: number | null;
    /** ADR-053: branch plan state and booking limits, online only. */
    limits: {
      paused: boolean;
      minLeadTimeMinutes: number;
      maxDaysAhead: number | null;
      dailyGuestCap: number | null;
    };
    now: Date;
  }): Promise<void> {
    if (!(await this.bookingEligibility.isRestaurantAcceptingReservations(input.restaurantId))) {
      throw new RestaurantNotAcceptingReservationsException();
    }

    const minutes = durationMinutes(input.startTime, input.endTime);
    if (minutes < MIN_RESERVATION_DURATION_MINUTES || minutes > MAX_RESERVATION_DURATION_MINUTES) {
      throw new InvalidReservationTimeException(
        `A reservation must last between ${MIN_RESERVATION_DURATION_MINUTES} and ${MAX_RESERVATION_DURATION_MINUTES} minutes.`,
      );
    }

    if (input.source !== ReservationSource.Online) {
      return;
    }

    if (!isWithinBookingHorizon(input.startTime, input.now)) {
      throw new InvalidReservationTimeException(
        `Reservations can be made at most ${MAX_ONLINE_BOOKING_ADVANCE_DAYS} days ahead.`,
      );
    }

    if (input.maxGuests !== null && input.guests > input.maxGuests) {
      throw new InvalidReservationException(
        `guests must not exceed the restaurant maximum of ${input.maxGuests}.`,
      );
    }

    await this.assertWithinBranchLimits(input);

    const schedule = await this.openingHours.load(input.branchId);
    if (!fitsOpeningHours(input.startTime, input.endTime, input.timeZone, schedule)) {
      throw new InvalidReservationTimeException(
        'The reservation must start and end within the branch opening hours.',
      );
    }

    const upcoming = await this.bookingEligibility.countUpcomingActiveForUser(
      input.userId,
      input.now,
    );
    if (upcoming >= MAX_UPCOMING_ONLINE_RESERVATIONS_PER_CUSTOMER) {
      throw new ActiveReservationLimitReachedException(
        MAX_UPCOMING_ONLINE_RESERVATIONS_PER_CUSTOMER,
      );
    }
  }

  private resolveEndTime(
    startTime: Date,
    clientEndTime: string | undefined,
    settings: { defaultReservationDurationMinutes: number } | null,
  ): Date {
    if (clientEndTime !== undefined) {
      const endTime = new Date(clientEndTime);
      if (Number.isNaN(endTime.getTime())) {
        throw new InvalidReservationTimeException('reservationEndTime is not a valid date-time.');
      }
      if (endTime.getTime() <= startTime.getTime()) {
        throw new InvalidReservationTimeException(
          'reservationEndTime must be after reservationStartTime.',
        );
      }
      return endTime;
    }

    const durationMinutes = settings?.defaultReservationDurationMinutes ?? 90;
    return new Date(startTime.getTime() + durationMinutes * 60_000);
  }
}
