import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReservationStatus } from '../../domain/enums/reservation.enums';

export interface ListBranchReservationsCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId: string;
  dateFrom: Date;
  dateTo: Date;
  status?: ReservationStatus;
  page: number;
  limit: number;
}
