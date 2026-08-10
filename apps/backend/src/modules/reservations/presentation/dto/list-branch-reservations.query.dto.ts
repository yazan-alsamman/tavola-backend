import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';

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
}
