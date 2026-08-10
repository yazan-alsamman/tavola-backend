import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';

export class StaffReservationTableResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ example: 'T12' })
  tableNumber!: string;

  @ApiProperty({ example: 4 })
  capacity!: number;
}

export class StaffReservationCustomerResponseDto {
  @ApiProperty({ enum: ['User', 'Guest'], description: 'Online (registered) vs Phone/WalkIn.' })
  type!: 'User' | 'Guest';

  @ApiPropertyOptional({ nullable: true, example: 'Jane Doe' })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+963991234567' })
  phone!: string | null;
}

export class BranchReservationItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  reservationId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

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

  @ApiProperty({ type: StaffReservationTableResponseDto })
  table!: StaffReservationTableResponseDto;

  @ApiProperty({ type: StaffReservationCustomerResponseDto })
  customer!: StaffReservationCustomerResponseDto;
}
