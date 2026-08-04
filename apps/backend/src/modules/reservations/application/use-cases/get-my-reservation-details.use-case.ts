import { Injectable } from '@nestjs/common';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { GetMyReservationUseCase } from './get-my-reservation.use-case';
import { GetMyReservationCommand } from '../dto/get-my-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 18.x (Customer Reservation History, final completion) -
 * `GET /reservations/my/:reservationId`. Deliberately a thin composition
 * over the already-shipped `GetMyReservationUseCase` (Phase 7.1's own
 * "Customer Restaurant Discovery & Public Read Surface" - unchanged, and
 * still backing `GET /reservations/:id` on its own route) rather than a
 * reimplementation: the ownership resolution/IDOR-safe-404 collapse is
 * proven correct there already, so this only adds the one thing that route
 * does NOT have - the same Customer-only actor-type gate as
 * `SearchMyReservationsUseCase` (the other three `GET /reservations/my*`
 * routes), so the whole `/my*` namespace behaves uniformly: an Employee or
 * OrganizationMember actor is rejected with 403 even when its JWT `userId`
 * happens to own the reservation (every actor type's JWT `userId`/`sub` is
 * the same underlying `User.id` - see `AccessTokenClaimsBuilder`'s own doc
 * comment). `GET /reservations/:id` itself is untouched - not "unrelated
 * modules", but a sibling, already-tested route this phase must not modify.
 */
@Injectable()
export class GetMyReservationDetailsUseCase {
  constructor(private readonly getMyReservationUseCase: GetMyReservationUseCase) {}

  async execute(command: GetMyReservationCommand): Promise<ReservationResult> {
    if (command.actor.actorType !== AccessTokenActorType.User) {
      throw new PermissionDeniedException();
    }
    return this.getMyReservationUseCase.execute(command);
  }
}
