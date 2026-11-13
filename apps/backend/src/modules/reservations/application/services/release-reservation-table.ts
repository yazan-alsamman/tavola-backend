import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import { TableRepository } from '@modules/tables/domain/repositories/table.repository';

/**
 * Releases the table an `Approved` reservation holds as it leaves Approved
 * (Complete, Cancel, NoShow). `Reservation.tableId` is a foreign key, so a
 * `null` from `findById` means the table was soft-deleted while the booking
 * stood: there is nothing left to release, and the reservation must still be
 * able to close. Throwing there left such bookings stuck in Approved and the
 * auto-close sweep failing on them every run.
 */
export async function releaseReservationTable(
  tableRepository: TableRepository,
  tableId: TableId,
  at: Date,
): Promise<void> {
  const table = await tableRepository.findById(tableId);
  if (table === null) {
    return;
  }
  await tableRepository.save(table.release(at));
}
