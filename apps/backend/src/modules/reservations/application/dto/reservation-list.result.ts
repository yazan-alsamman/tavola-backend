import { ReservationResult } from './reservation.result';

export interface ReservationListResult {
  items: ReservationResult[];
  page: number;
  limit: number;
  total: number;
}
