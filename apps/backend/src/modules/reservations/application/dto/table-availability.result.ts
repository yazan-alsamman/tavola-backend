import { TableShape } from '@modules/tables/domain/enums/table.enums';

/**
 * Phase 7.1 architecture decision (Availability Search Contract): every
 * table matching the search criteria is returned, never hidden - `isAvailable`
 * is the indicator the UI must read; presence in this list does not itself
 * mean bookable.
 */
export interface TableAvailabilityResult {
  tableId: string;
  tableNumber: string;
  capacity: number;
  shape: TableShape;
  isAvailable: boolean;
}
