import { MyReservationItem } from '../ports/my-reservations-reader.port';

export interface MyReservationsListResult {
  items: MyReservationItem[];
  page: number;
  limit: number;
  total: number;
}
