import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { assertActorCanOperateReservation } from '../services/assert-employee-reservation-scope';
import {
  ReservationInternalNoteResult,
  UpdateReservationInternalNoteCommand,
} from '../dto/update-reservation-internal-note.command';

/**
 * CR WJ-R-2026-002 round 2 - the staff-only internal note on a reservation
 * (special request, allergy). Same actor rule as creating a staff booking:
 * Owner/Admin of the owning organization, or a branch-scoped Employee
 * holding `reservations:create` (reception already holds it, so no new
 * permission slug). Allowed in every status so staff can annotate a past
 * visit too. A blank note clears it.
 */
@Injectable()
export class UpdateReservationInternalNoteUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(
    command: UpdateReservationInternalNoteCommand,
  ): Promise<ReservationInternalNoteResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    await assertActorCanOperateReservation(
      command.actor,
      existing,
      'reservations:create',
      this.restaurantRepository,
    );

    const trimmed = command.internalNote?.trim() ?? '';
    const note = trimmed.length > 0 ? trimmed : null;
    await this.reservationRepository.updateInternalNote(reservationId, note, this.clock.now());
    return { reservationId: reservationId.value, internalNote: note };
  }
}
