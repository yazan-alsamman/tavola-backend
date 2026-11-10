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

  @ApiPropertyOptional({
    nullable: true,
    example: 'guest:+963991234567',
    description:
      'Stable handle for this customer at the restaurant: user:<uuid> or guest:<E.164 phone>. Pass it as customerKey to list only their bookings.',
  })
  key!: string | null;

  @ApiProperty({ example: 3, description: 'Completed visits at this restaurant, all branches.' })
  visitCount!: number;

  @ApiProperty({ example: 0, description: 'No-shows at this restaurant, all branches.' })
  noShowCount!: number;
}

export class StaffReservationStatusChangeResponseDto {
  @ApiProperty({ enum: ReservationStatus })
  status!: ReservationStatus;

  @ApiProperty({
    enum: ['Customer', 'Restaurant', 'System'],
    description: 'Who moved the reservation into its current final status.',
  })
  changedBy!: 'Customer' | 'Restaurant' | 'System';

  @ApiPropertyOptional({ nullable: true, example: 'Guest asked to cancel by phone' })
  reason!: string | null;

  @ApiProperty({ format: 'date-time' })
  changedAt!: string;
}

export class StaffReservationOfferResponseDto {
  @ApiProperty({ format: 'uuid' })
  offerId!: string;

  @ApiProperty({ example: 'Weekday lunch 20% off' })
  title!: string;
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

  @ApiPropertyOptional({
    type: StaffReservationOfferResponseDto,
    nullable: true,
    description: 'The offer the customer booked from, or null for an ordinary booking.',
  })
  offer!: StaffReservationOfferResponseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Staff-only note (special request, allergy). Never shown to the customer.',
  })
  internalNote!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'When this Pending booking expires if nobody answers it; null in any other status.',
  })
  approvalDeadlineAt!: string | null;

  @ApiPropertyOptional({
    type: StaffReservationStatusChangeResponseDto,
    nullable: true,
    description:
      'Who moved the booking into its final status (Rejected, Cancelled, Completed, Expired, NoShow) and the reason given; null while Pending or Approved.',
  })
  statusChange!: StaffReservationStatusChangeResponseDto | null;
}
