import { Injectable, Inject } from '@nestjs/common';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  MyReservationsReaderPort,
  MY_RESERVATIONS_READER,
} from '../ports/my-reservations-reader.port';
import { SearchMyReservationsCommand } from '../dto/search-my-reservations.command';
import { MyReservationsListResult } from '../dto/my-reservations-list.result';

/**
 * Phase 18.x (Customer Reservation History, mobile-facing) - the single use
 * case behind all three `GET /reservations/my*` routes
 * (`ReservationsController.myReservations`/`myUpcomingReservations`/
 * `myReservationHistory`, differing only in the `scope` they pass in). The
 * `all`/`upcoming`/`history` split itself is resolved entirely inside
 * `MyReservationsReaderPort.search` (one `WHERE` clause per scope) - this
 * use case never branches on `scope` beyond forwarding it, so there is
 * exactly one place (`PrismaMyReservationsReader.buildWhere`) that knows
 * what "upcoming" or "history" means (the phase spec's own "reuse the same
 * repository and query logic... avoid code duplication" instruction).
 *
 * Deliberately stricter than `ListMyReservationsUseCase`/
 * `GetMyReservationUseCase` (Phase 7.1's "Customer Restaurant Discovery &
 * Public Read Surface"): those two rely on ownership matching alone (any
 * `AuthenticatedActor` whose `userId` matches `Reservation.userId`), which
 * is IDOR-safe but does not exclude an Employee/OrganizationMember actor who
 * ALSO happens to hold a personal Customer reservation (Phase 7.4: Online
 * self-booking is reachable by any authenticated actor type, and every
 * actor type's JWT `userId`/`sub` is the same underlying `User.id` - see
 * `AccessTokenClaimsBuilder`'s own doc comment). This endpoint family's own
 * contract ("Authenticated Customer only... No Employee... No
 * OrganizationMember") is an explicit actor-type gate, not an ownership
 * check - `assertActorCanModifyReservation`'s own "any other actor type...
 * is denied outright" `PermissionDeniedException` is reused verbatim for
 * the same reason.
 */
@Injectable()
export class SearchMyReservationsUseCase {
  constructor(
    @Inject(MY_RESERVATIONS_READER)
    private readonly reader: MyReservationsReaderPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: SearchMyReservationsCommand): Promise<MyReservationsListResult> {
    if (command.actor.actorType !== AccessTokenActorType.User) {
      throw new PermissionDeniedException();
    }

    const page = await this.reader.search(
      command.actor.userId,
      command.scope,
      {
        status: command.status,
        restaurantId: command.restaurantId,
        branchId: command.branchId,
        dateFrom: command.dateFrom,
        dateTo: command.dateTo,
      },
      command.page,
      command.limit,
      command.sort,
      command.order,
      this.clock.now(),
    );

    return {
      items: page.items,
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
