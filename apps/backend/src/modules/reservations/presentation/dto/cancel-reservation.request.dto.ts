import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelReservationRequestDto {
  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Optional cancellation reason, recorded on the ReservationHistory row.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}
