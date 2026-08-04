import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';

export class MyReservationTableResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ example: 'T12' })
  tableNumber!: string;

  @ApiProperty({ example: 4 })
  capacity!: number;
}

export class MyReservationItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  reservationId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'The Old Mill' })
  restaurantName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Restaurant.coverImageId - a media asset id, null when never set.',
  })
  restaurantImage!: string | null;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({
    example: '123 Main St',
    description: "The branch's address (Branch has no separate name field).",
  })
  branchName!: string;

  @ApiProperty({ format: 'date' })
  reservationDate!: string;

  @ApiProperty({ format: 'date-time' })
  reservationStartTime!: string;

  @ApiProperty({ format: 'date-time' })
  reservationEndTime!: string;

  @ApiProperty({ example: 2 })
  partySize!: number;

  @ApiProperty({ enum: ReservationStatus })
  status!: ReservationStatus;

  @ApiProperty({ enum: ReservationSource })
  reservationSource!: ReservationSource;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ nullable: true, example: null })
  specialRequest!: string | null;

  @ApiPropertyOptional({ type: MyReservationTableResponseDto, nullable: true })
  table!: MyReservationTableResponseDto | null;
}
