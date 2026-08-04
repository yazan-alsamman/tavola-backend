import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export const MY_RESERVATIONS_SORT_FIELDS = ['reservationDate', 'createdAt'] as const;
export const MY_RESERVATIONS_SORT_ORDERS = ['asc', 'desc'] as const;

/**
 * Phase 18.x (Customer Reservation History, mobile-facing) - the filter/
 * sort/pagination params shared by all three `GET /reservations/my*` routes
 * (`page`/`limit`/`restaurantId`/`branchId`/`dateFrom`/`dateTo`/`sort`/
 * `order`, per the phase spec). `GET /reservations/my` additionally accepts
 * `status` - see `MyReservationsQueryDto`, which extends this class rather
 * than duplicating every field here.
 */
export class MyReservationsBaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-01-01',
    description: 'Inclusive lower bound against reservationDate.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-12-31',
    description: 'Inclusive upper bound against reservationDate.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: MY_RESERVATIONS_SORT_FIELDS,
    default: 'reservationDate',
    description: 'Defaults to reservationDate.',
  })
  @IsOptional()
  @IsIn(MY_RESERVATIONS_SORT_FIELDS)
  sort?: (typeof MY_RESERVATIONS_SORT_FIELDS)[number];

  @ApiPropertyOptional({
    enum: MY_RESERVATIONS_SORT_ORDERS,
    default: 'desc',
    description: 'Defaults to desc (most recent first).',
  })
  @IsOptional()
  @IsIn(MY_RESERVATIONS_SORT_ORDERS)
  order?: (typeof MY_RESERVATIONS_SORT_ORDERS)[number];
}
