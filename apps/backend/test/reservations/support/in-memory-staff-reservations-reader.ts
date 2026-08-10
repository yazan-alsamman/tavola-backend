import {
  StaffReservationItem,
  StaffReservationsFilters,
  StaffReservationsPage,
  StaffReservationsReaderPort,
} from '@modules/reservations/application/ports/staff-reservations-reader.port';

/**
 * Test double for `ListBranchReservationsUseCase` unit tests - filters and
 * paginates seeded rows entirely in-memory, mirroring
 * `InMemoryMyReservationsReader`'s own approach (never touches Prisma -
 * `PrismaStaffReservationsReader` is covered separately by its own
 * integration spec).
 */
export class InMemoryStaffReservationsReader implements StaffReservationsReaderPort {
  private readonly rows: StaffReservationItem[] = [];
  public lastRestaurantId: string | undefined;
  public lastBranchId: string | undefined;

  seed(item: StaffReservationItem): void {
    this.rows.push(item);
  }

  async search(
    restaurantId: string,
    branchId: string,
    filters: StaffReservationsFilters,
    page: number,
    limit: number,
  ): Promise<StaffReservationsPage> {
    this.lastRestaurantId = restaurantId;
    this.lastBranchId = branchId;

    let rows = this.rows.filter(
      (row) => row.restaurantId === restaurantId && row.branchId === branchId,
    );
    rows = rows.filter(
      (row) =>
        row.reservationDate.getTime() >= filters.dateFrom.getTime() &&
        row.reservationDate.getTime() <= filters.dateTo.getTime(),
    );
    if (filters.status !== undefined) {
      rows = rows.filter((row) => row.status === filters.status);
    }

    rows = [...rows].sort(
      (a, b) => a.reservationStartTime.getTime() - b.reservationStartTime.getTime(),
    );

    const start = (page - 1) * limit;
    return { items: rows.slice(start, start + limit), total: rows.length };
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: StaffReservationsReaderPort = new InMemoryStaffReservationsReader();
void _typeCheck;
