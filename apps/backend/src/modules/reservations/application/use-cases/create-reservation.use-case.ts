import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { BranchId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
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
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationAvailabilityService } from '../../domain/services/reservation-availability.service';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { TableUnavailableException } from '../../domain/exceptions/table-unavailable.exception';
import { ReservationCreatedEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { CreateReservationCommand } from '../dto/create-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.1 (TASKS.md Phase 7.1 Scope Amendment, 2026-07-20): always produces
 * a `Pending` reservation - `RestaurantSettings.autoApproval` is not read by
 * this use case at all; `Table.reserve()`/`TableStatus.Reserved` do not
 * exist yet and are never called here. Customer-facing (any authenticated
 * actor type, matching `UsersController`'s own-resource precedent) - no
 * organization/branch-scope guard.
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
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: CreateReservationCommand): Promise<ReservationResult> {
    const branchId = BranchId.create(command.branchId);
    const tableId = TableId.create(command.tableId);

    const branch = await this.branchRepository.findById(branchId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const table = await this.tableRepository.findByIdAndBranchId(tableId, branchId);
    if (table === null) {
      throw new TableNotFoundException();
    }
    if (table.status !== TableStatus.Available) {
      throw new TableUnavailableException();
    }

    const startTime = new Date(command.reservationStartTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new InvalidReservationTimeException('reservationStartTime is not a valid date-time.');
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      branch.restaurantId,
    );
    const endTime = this.resolveEndTime(startTime, command.reservationEndTime, settings);

    const now = this.clock.now();
    const reservationDate = new Date(
      Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate()),
    );

    const reservation = Reservation.create({
      id: this.idGenerator.generate(),
      userId: command.actor.userId,
      restaurantId: branch.restaurantId.value,
      branchId: branchId.value,
      tableId: tableId.value,
      reservationDate,
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: command.guests,
      tableCapacity: table.capacity,
      notes: command.notes ?? null,
      createdBy: command.actor.userId,
      now,
    });

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

    await this.reservationRepository.createWithLock(reservation, lockKey);

    await this.eventPublisher.publish(
      new ReservationCreatedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservation.reservationId.value,
          restaurantId: branch.restaurantId.value,
          branchId: branchId.value,
          tableId: tableId.value,
          userId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toReservationResult(reservation);
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
