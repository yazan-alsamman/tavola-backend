import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { MyReservationsBaseQueryDto } from './my-reservations-base.query.dto';

/**
 * `GET /reservations/my`'s own query params - every filter is optional; an
 * all-omitted request returns the caller's complete reservation set
 * (`upcoming` + `history` combined), newest `reservationDate` first. The
 * only field `/my/upcoming`/`/my/history` do NOT also accept - see
 * `MyReservationsBaseQueryDto`'s own doc comment.
 */
export class MyReservationsQueryDto extends MyReservationsBaseQueryDto {
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsIn(Object.values(ReservationStatus))
  status?: ReservationStatus;
}
