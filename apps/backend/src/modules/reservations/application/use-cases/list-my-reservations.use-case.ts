import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { ListMyReservationsCommand } from '../dto/list-my-reservations.command';
import { ReservationListResult } from '../dto/reservation-list.result';

/**
 * Customer Restaurant Discovery & Public Read Surface (Reservation privacy
 * boundary). Ownership-only, no RBAC - mirrors `ListMyReviewsUseCase`/
 * `/users/me/favorites` exactly. Always the caller's own reservations (from
 * the JWT), never a client-supplied userId - a guest (Phone/WalkIn)
 * reservation has no owning User and never appears here (see
 * `ReservationRepository.findManyByUserId`'s own doc comment).
 */
@Injectable()
export class ListMyReservationsUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
  ) {}

  async execute(command: ListMyReservationsCommand): Promise<ReservationListResult> {
    const userId = UserId.create(command.actor.userId);
    const page = await this.reservationRepository.findManyByUserId(
      userId,
      command.page,
      command.limit,
    );
    return {
      items: page.items.map(toReservationResult),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
