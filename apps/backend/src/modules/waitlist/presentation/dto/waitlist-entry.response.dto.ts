import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';

export class WaitlistEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  entryId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  reservationGuestId!: string | null;

  @ApiProperty({ example: 4 })
  partySize!: number;

  @ApiProperty({ format: 'date' })
  preferredDate!: string;

  @ApiProperty({ example: '19:00:00' })
  preferredTimeFrom!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  preferredTimeTo!: string | null;

  @ApiProperty({ enum: WaitlistStatus })
  status!: WaitlistStatus;

  @ApiProperty({ example: 3, description: 'FIFO position within (branchId, preferredDate).' })
  position!: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  convertedReservationId!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  notifiedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
