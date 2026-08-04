import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import {
  MyReservationsSort,
  MyReservationsSortOrder,
  MyReservationTemporalScope,
} from '../ports/my-reservations-reader.port';

export interface SearchMyReservationsCommand {
  actor: AuthenticatedActor;
  scope: MyReservationTemporalScope;
  page: number;
  limit: number;
  /** Only ever populated for scope 'all' - see `MyReservationsFilters`'s own doc comment. */
  status?: ReservationStatus;
  restaurantId?: string;
  branchId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sort: MyReservationsSort;
  order: MyReservationsSortOrder;
}
