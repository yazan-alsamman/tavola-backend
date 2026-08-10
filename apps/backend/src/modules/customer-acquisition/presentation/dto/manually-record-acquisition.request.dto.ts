import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class ManuallyRecordAcquisitionRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  restaurantId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Exactly one of userId/reservationGuestId is required.',
  })
  @ValidateIf((dto: ManuallyRecordAcquisitionRequestDto) => !dto.reservationGuestId)
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Exactly one of userId/reservationGuestId is required.',
  })
  @ValidateIf((dto: ManuallyRecordAcquisitionRequestDto) => !dto.userId)
  @IsUUID()
  reservationGuestId?: string;

  @ApiProperty({
    example:
      'Confirmed with the restaurant this customer was never recorded (source mislabeled as WalkIn).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
