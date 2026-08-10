import { StaffReservationItem } from '../ports/staff-reservations-reader.port';

export interface BranchReservationsListResult {
  items: StaffReservationItem[];
  page: number;
  limit: number;
  total: number;
}
