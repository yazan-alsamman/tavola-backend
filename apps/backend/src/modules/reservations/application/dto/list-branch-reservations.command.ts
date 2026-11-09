import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { StaffReservationCustomerKey } from '../ports/staff-reservations-reader.port';

export interface ListBranchReservationsCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId: string;
  dateFrom: Date;
  dateTo: Date;
  status?: ReservationStatus;
  customerKey?: StaffReservationCustomerKey;
  page: number;
  limit: number;
}
