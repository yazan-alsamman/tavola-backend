import {
  MyReservationItem,
  MyReservationsFilters,
  MyReservationsPage,
  MyReservationsReaderPort,
  MyReservationsSort,
  MyReservationsSortOrder,
  MyReservationTemporalScope,
} from '@modules/reservations/application/ports/my-reservations-reader.port';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';

const ACTIVE_STATUSES = [ReservationStatus.Pending, ReservationStatus.Approved];
const TERMINAL_STATUSES = [
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.Completed,
  ReservationStatus.Expired,
  ReservationStatus.NoShow,
];

/**
 * Test double for `SearchMyReservationsUseCase` unit tests - filters, scopes,
 * sorts, and paginates seeded rows entirely in-memory, mirroring
 * `InMemoryReservationRepository.findManyByUserId`'s own approach (never
 * touches Prisma - `PrismaMyReservationsReader` is covered separately by its
 * own integration spec). The `upcoming`/`history` scope logic here is a
 * deliberate line-for-line mirror of `PrismaMyReservationsReader.buildWhere`
 * so a unit test against this fake proves the same behavior the real reader
 * implements.
 */
export class InMemoryMyReservationsReader implements MyReservationsReaderPort {
  private readonly rowsByUser = new Map<string, MyReservationItem[]>();
  public lastUserId: string | undefined;
  public lastScope: MyReservationTemporalScope | undefined;

  seed(userId: string, item: MyReservationItem): void {
    const existing = this.rowsByUser.get(userId) ?? [];
    existing.push(item);
    this.rowsByUser.set(userId, existing);
  }

  async search(
    userId: string,
    scope: MyReservationTemporalScope,
    filters: MyReservationsFilters,
    page: number,
    limit: number,
    sort: MyReservationsSort,
    order: MyReservationsSortOrder,
    now: Date,
  ): Promise<MyReservationsPage> {
    this.lastUserId = userId;
    this.lastScope = scope;
    let rows = [...(this.rowsByUser.get(userId) ?? [])];

    if (filters.restaurantId !== undefined) {
      rows = rows.filter((row) => row.restaurantId === filters.restaurantId);
    }
    if (filters.branchId !== undefined) {
      rows = rows.filter((row) => row.branchId === filters.branchId);
    }
    if (filters.dateFrom !== undefined) {
      rows = rows.filter((row) => row.reservationDate.getTime() >= filters.dateFrom!.getTime());
    }
    if (filters.dateTo !== undefined) {
      rows = rows.filter((row) => row.reservationDate.getTime() <= filters.dateTo!.getTime());
    }

    if (scope === 'upcoming') {
      rows = rows.filter(
        (row) =>
          ACTIVE_STATUSES.includes(row.status) &&
          row.reservationStartTime.getTime() > now.getTime(),
      );
    } else if (scope === 'history') {
      rows = rows.filter(
        (row) =>
          TERMINAL_STATUSES.includes(row.status) ||
          (ACTIVE_STATUSES.includes(row.status) &&
            row.reservationStartTime.getTime() <= now.getTime()),
      );
    } else if (filters.status !== undefined) {
      rows = rows.filter((row) => row.status === filters.status);
    }

    rows.sort((a, b) => {
      const diff = a[sort].getTime() - b[sort].getTime();
      return order === 'asc' ? diff : -diff;
    });

    const start = (page - 1) * limit;
    return { items: rows.slice(start, start + limit), total: rows.length };
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: MyReservationsReaderPort = new InMemoryMyReservationsReader();
void _typeCheck;
