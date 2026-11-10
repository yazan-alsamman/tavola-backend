import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';

/** `user:<uuid>` or `guest:<E.164 phone>`, as returned on `customer.key`. */
export const CUSTOMER_KEY_PATTERN =
  /^(user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|guest:\+[1-9][0-9]{6,14})$/;

/**
 * Restaurant Dashboard Calendar query params - one date-range endpoint
 * serves Day/Week/Month views (see `BranchReservationsController`'s own doc
 * comment). Unlike `MyReservationsBaseQueryDto`'s optional `dateFrom`/
 * `dateTo` (a Customer's own reservation set safely defaults to "all time"),
 * both are REQUIRED here - a branch's full reservation history is not safe
 * to return unbounded, and the calendar UI always has a concrete window to
 * ask for anyway.
 */
export class ListBranchReservationsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    format: 'date',
    example: '2026-01-01',
    description: 'Inclusive lower bound against reservationDate.',
  })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-01-31',
    description: 'Inclusive upper bound against reservationDate.',
  })
  @IsDateString()
  dateTo!: string;

  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsIn(Object.values(ReservationStatus))
  status?: ReservationStatus;

  @ApiPropertyOptional({
    example: 'guest:+963991234567',
    description:
      "Only this customer's bookings: the customer.key from a list item (user:<uuid> or guest:<E.164 phone>).",
  })
  @IsOptional()
  @Matches(CUSTOMER_KEY_PATTERN)
  customerKey?: string;
}
