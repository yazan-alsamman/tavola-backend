import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';

export class ReservationResponseDto {
  @ApiProperty({ format: 'uuid' })
  reservationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'date' })
  reservationDate!: string;

  @ApiProperty({ format: 'date-time' })
  reservationStartTime!: string;

  @ApiProperty({ format: 'date-time' })
  reservationEndTime!: string;

  @ApiProperty({ example: 2 })
  guests!: number;

  @ApiProperty({
    enum: ReservationStatus,
    description: 'Phase 7.1 only ever produces Pending - Approval is a later sub-phase.',
  })
  status!: ReservationStatus;

  @ApiProperty({ enum: ReservationSource })
  source!: ReservationSource;

  @ApiPropertyOptional({ example: null, nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
