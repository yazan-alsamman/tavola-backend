import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
  UNIT_OF_WORK,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { ReservationGuest } from '@modules/reservations/domain/entities/reservation-guest.entity';
import {
  ReservationGuestRepository,
  RESERVATION_GUEST_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation-guest.repository';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistSlotService } from '../../domain/services/waitlist-slot.service';
import { WaitlistPreferredTimeInPastException } from '../../domain/exceptions/waitlist-preferred-time-in-past.exception';
import { InvalidWaitlistEntryException } from '../../domain/exceptions/invalid-waitlist-entry.exception';
import { WaitlistEntryCreatedEvent } from '../../domain/events/waitlist.events';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '../../domain/repositories/reservation-waitlist-entry.repository';
import { assertEmployeeCanJoinWaitlist } from '../services/assert-actor-can-modify-waitlist-entry';
import {
  WaitlistExpirationSchedulerPort,
  WAITLIST_EXPIRATION_SCHEDULER,
} from '../ports/waitlist-expiration-scheduler.port';
import { toWaitlistEntryResult } from '../mappers/waitlist-entry-result.mapper';
import { JoinWaitlistCommand } from '../dto/join-waitlist.command';
import { WaitlistEntryResult } from '../dto/waitlist-entry.result';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phase 7.5 architecture freeze item 7/8 (`POST /waitlist`) - guard-light,
 * dual-actor dispatch inside the use case, mirroring
 * `CreateReservationUseCase`'s Online-vs-Phone/WalkIn split exactly (Phase
 * 7.4 precedent): a Customer (any actor type) joins for themselves using
 * their own `userId`; supplying `reservationGuest` is reachable only by an
 * Employee actor holding `reservations:waitlist` for the target Branch.
 * `preferredDate`+`preferredTimeFrom` are required and validated against
 * `Branch.timezone` (freeze item 1/final decision) - a request whose derived
 * start time is already in the past is rejected immediately rather than
 * silently queued.
 */
@Injectable()
export class JoinWaitlistUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESERVATION_GUEST_REPOSITORY)
    private readonly reservationGuestRepository: ReservationGuestRepository,
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(WAITLIST_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: WaitlistExpirationSchedulerPort,
  ) {}

  async execute(command: JoinWaitlistCommand): Promise<WaitlistEntryResult> {
    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findById(branchId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    if (
      command.reservationGuest !== undefined &&
      command.actor.actorType === AccessTokenActorType.Employee
    ) {
      assertEmployeeCanJoinWaitlist(
        command.actor,
        branch.restaurantId,
        branchId,
        'reservations:waitlist',
      );
    }

    const preferredDate = parseDateOnly(command.preferredDate);
    const preferredTimeFrom = parseTimeOfDay(command.preferredTimeFrom, 'preferredTimeFrom');
    const preferredTimeTo = command.preferredTimeTo
      ? parseTimeOfDay(command.preferredTimeTo, 'preferredTimeTo')
      : null;

    const now = this.clock.now();
    const reservationStartTime = WaitlistSlotService.deriveReservationStartTime(
      preferredDate,
      preferredTimeFrom,
      branch.timezone,
    );
    if (reservationStartTime.getTime() <= now.getTime()) {
      throw new WaitlistPreferredTimeInPastException();
    }
    const expiresAt = WaitlistSlotService.computeExpiresAt(preferredDate, branch.timezone);

    const party = this.resolveParty(command, now);

    let entry!: ReservationWaitlistEntry;
    await this.unitOfWork.execute(async () => {
      // Phase 7.5 §9: advisory lock keyed by (branchId, preferredDate),
      // serializing concurrent Joins for the same queue scope before
      // computing a fresh position - the same pg_advisory_xact_lock
      // technique ADR-013 established, generalized to a new namespace.
      await this.waitlistRepository.acquireQueueLock(branchId, preferredDate);
      const maxPosition = await this.waitlistRepository.findMaxPositionForScope(
        branchId,
        preferredDate,
      );

      if (party.guest !== null) {
        await this.reservationGuestRepository.save(party.guest);
      }

      entry = ReservationWaitlistEntry.create({
        id: this.idGenerator.generate(),
        restaurantId: branch.restaurantId.value,
        branchId: branchId.value,
        userId: party.userId,
        reservationGuestId: party.reservationGuestId,
        partySize: command.partySize,
        preferredDate,
        preferredTimeFrom,
        preferredTimeTo,
        position: maxPosition + 1,
        expiresAt,
        notes: command.notes ?? null,
        createdBy: party.createdBy,
        now,
      });

      await this.waitlistRepository.createInTransaction(entry);
    });

    // Phase 7.3 precedent: scheduled after the transaction commits -
    // queuing to Redis is external I/O, never inside the locked
    // transaction (CODING_STANDARDS.md).
    await this.expirationScheduler.scheduleExpiration(
      entry.entryId,
      null,
      expiresAt,
      command.correlationId,
    );

    await this.eventPublisher.publish(
      new WaitlistEntryCreatedEvent(
        this.idGenerator.generate(),
        {
          entryId: entry.entryId,
          restaurantId: branch.restaurantId.value,
          branchId: branchId.value,
          userId: party.userId,
          reservationGuestId: party.reservationGuestId,
          createdBy: party.createdBy,
        },
        now,
        command.correlationId,
      ),
    );

    return toWaitlistEntryResult(entry);
  }

  /**
   * Mirrors `CreateReservationUseCase.resolveParty` exactly: `userId`/
   * `createdBy` always come from the actor's own verified identity, never a
   * client-supplied field.
   */
  private resolveParty(
    command: JoinWaitlistCommand,
    now: Date,
  ): {
    userId: string | null;
    reservationGuestId: string | null;
    createdBy: string;
    guest: ReservationGuest | null;
  } {
    if (!command.reservationGuest) {
      return {
        userId: command.actor.userId,
        reservationGuestId: null,
        createdBy: command.actor.userId,
        guest: null,
      };
    }

    if (command.actor.actorType !== AccessTokenActorType.Employee) {
      // Unreachable in practice: no client can supply reservationGuest
      // without also passing the Employee-only branch/permission check
      // above, since a non-Employee actor never satisfies that check's own
      // actorType guard. Kept as a defensive guard so this method never
      // silently mis-attributes an entry.
      throw new PermissionDeniedException();
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
}

function parseDateOnly(value: string): Date {
  if (!DATE_REGEX.test(value)) {
    throw new InvalidWaitlistEntryException(
      'preferredDate must be an ISO date string (YYYY-MM-DD).',
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidWaitlistEntryException('preferredDate is not a valid date.');
  }
  return date;
}

function parseTimeOfDay(value: string, fieldName: string): Date {
  const match = TIME_REGEX.exec(value);
  if (!match) {
    throw new InvalidWaitlistEntryException(`${fieldName} must be a valid HH:mm or HH:mm:ss time.`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, seconds));
}
