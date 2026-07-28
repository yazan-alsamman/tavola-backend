import { Injectable, Inject } from '@nestjs/common';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { GetMyReservationCommand } from '../dto/get-my-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Customer Restaurant Discovery & Public Read Surface (Reservation privacy
 * boundary). Ownership-only: an unknown, foreign-owned, or guest-owned
 * (`reservationGuestId` set, `userId` null) reservation collapses to the
 * same 404 as "not found" - IDOR-safe, matching every other owned-resource
 * convention in this codebase (never a distinguishing 403). Never exposes
 * `ReservationGuest` data or any other Customer's reservation.
 */
@Injectable()
export class GetMyReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
  ) {}

  async execute(command: GetMyReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const reservation = await this.reservationRepository.findById(reservationId);
    if (reservation === null || reservation.userId === null) {
      throw new ReservationNotFoundException();
    }
    if (reservation.userId.value !== command.actor.userId) {
      throw new ReservationNotFoundException();
    }
    return toReservationResult(reservation);
  }
}
