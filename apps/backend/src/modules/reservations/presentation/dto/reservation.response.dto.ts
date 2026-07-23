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
    description:
      'Pending (manual-approval path) or Approved directly (RestaurantSettings.autoApproval = true, Phase 7.2) at creation time; Approved/Rejected via POST /reservations/:id/approve|reject; Cancelled/Completed/NoShow/Expired via the Phase 7.3 lifecycle actions.',
  })
  status!: ReservationStatus;

  @ApiProperty({ enum: ReservationSource })
  source!: ReservationSource;

  @ApiPropertyOptional({ example: null, nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'The approving Employee id (manual Approve), null for auto-approval (system/settings-driven) or while still Pending/Rejected.',
  })
  approvedBy!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  approvedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  noShowAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
