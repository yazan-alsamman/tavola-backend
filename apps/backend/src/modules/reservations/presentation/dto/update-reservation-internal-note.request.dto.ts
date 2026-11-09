import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** CR WJ-R-2026-002 round 2: staff-only note on a reservation. Blank or null clears it. */
export class UpdateReservationInternalNoteRequestDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: 1000,
    example: 'Nut allergy. Prefers a window table.',
    description:
      'Visible to restaurant staff only, never to the customer. Blank or null clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNote?: string | null;
}

export class ReservationInternalNoteResponseDto {
  @ApiProperty({ format: 'uuid' })
  reservationId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Nut allergy. Prefers a window table.' })
  internalNote!: string | null;
}
