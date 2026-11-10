import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  OfferAttendedValue,
  OfferBookingCounts,
  OfferImpactReaderPort,
  OfferSlotFilter,
} from '../../application/ports/offer-impact-reader.port';

/**
 * ADR-047. Read-only aggregates over `reservations`. Callers resolve the
 * restaurant through the tenant-scoped `RestaurantRepository` first; every
 * query here is keyed by that restaurant or by an offer of it. Days and
 * hours are read in each branch's own time zone.
 */
@Injectable()
export class PrismaOfferImpactReader implements OfferImpactReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async countOfferBookings(offerId: string): Promise<OfferBookingCounts> {
    const rows = await this.prismaContext.client.$queryRaw<
      { bookings: number; persons: number; attended: number; new_customers: number }[]
    >`
      SELECT COUNT(*)::int AS bookings,
             COALESCE(SUM(r.guests), 0)::int AS persons,
             COUNT(*) FILTER (WHERE r.status = 'Completed')::int AS attended,
             COUNT(*) FILTER (WHERE NOT EXISTS (
               SELECT 1
               FROM reservations p
               LEFT JOIN reservation_guests pg ON pg.id = p.reservation_guest_id
               WHERE p.restaurant_id = r.restaurant_id
                 AND p.id <> r.id
                 AND p.created_at < r.created_at
                 AND (
                   (r.user_id IS NOT NULL AND p.user_id = r.user_id)
                   OR (r.user_id IS NULL AND p.user_id IS NULL AND g.phone IS NOT NULL AND pg.phone = g.phone)
                 )
             ))::int AS new_customers
      FROM reservations r
      LEFT JOIN reservation_guests g ON g.id = r.reservation_guest_id
      WHERE r.offer_id = ${offerId}::uuid
        AND r.status NOT IN ('Rejected', 'Cancelled', 'Expired')
    `;
    const row = rows[0];
    return {
      bookings: row?.bookings ?? 0,
      persons: row?.persons ?? 0,
      attended: row?.attended ?? 0,
      newCustomerBookings: row?.new_customers ?? 0,
    };
  }

  async countSlotBookings(filter: OfferSlotFilter, from: Date, to: Date): Promise<number> {
    if (to.getTime() <= from.getTime()) {
      return 0;
    }
    const rows = await this.prismaContext.client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM reservations r
      JOIN branches b ON b.id = r.branch_id
      WHERE r.restaurant_id = ${filter.restaurantId}::uuid
        AND r.status NOT IN ('Rejected', 'Cancelled', 'Expired')
        AND r.reservation_start_time >= ${from}
        AND r.reservation_start_time < ${to}
        AND (cardinality(${filter.branchIds}::uuid[]) = 0 OR r.branch_id = ANY(${filter.branchIds}::uuid[]))
        AND (cardinality(${filter.daysOfWeek}::int[]) = 0
             OR EXTRACT(DOW FROM r.reservation_start_time AT TIME ZONE b.timezone)::int = ANY(${filter.daysOfWeek}::int[]))
        AND (${filter.fromMinute}::int IS NULL OR (
             EXTRACT(HOUR FROM r.reservation_start_time AT TIME ZONE b.timezone)::int * 60
             + EXTRACT(MINUTE FROM r.reservation_start_time AT TIME ZONE b.timezone)::int
           ) >= ${filter.fromMinute}::int)
        AND (${filter.toMinute}::int IS NULL OR (
             EXTRACT(HOUR FROM r.reservation_start_time AT TIME ZONE b.timezone)::int * 60
             + EXTRACT(MINUTE FROM r.reservation_start_time AT TIME ZONE b.timezone)::int
           ) < ${filter.toMinute}::int)
    `;
    return rows[0]?.count ?? 0;
  }

  async attendedValueByCurrency(offerId: string): Promise<OfferAttendedValue[]> {
    const rows = await this.prismaContext.client.$queryRaw<
      { currency: string | null; attended: number; value: number; unpriced: number }[]
    >`
      SELECT COALESCE(b.currency, rs.default_currency) AS currency,
             COUNT(*)::int AS attended,
             COALESCE(SUM(r.guests * b.reference_price), 0)::float8 AS value,
             COALESCE(SUM(r.guests) FILTER (WHERE b.reference_price IS NULL), 0)::int AS unpriced
      FROM reservations r
      JOIN branches b ON b.id = r.branch_id
      LEFT JOIN restaurant_settings rs ON rs.restaurant_id = r.restaurant_id
      WHERE r.offer_id = ${offerId}::uuid
        AND r.status = 'Completed'
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((row) => ({
      currency: row.currency,
      attendedBookings: row.attended,
      personsTimesReferencePrice: Number(row.value),
      unpricedPersons: row.unpriced,
    }));
  }
}
