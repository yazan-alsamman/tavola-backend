import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PhoneIdentifierRequestDto } from '@modules/authentication/presentation/dto/phone-identifier.request.dto';

/**
 * Phase 7.4 decision #4: extends the same `countryCode`/`phoneNumber` shape
 * every Customer phone-identity endpoint already uses (ADR-022) - reused,
 * not duplicated. Required only when `CreateReservationRequestDto.source` is
 * `Phone`/`WalkIn` (`CreateReservationRequestDto`'s own `@ValidateIf`).
 */
export class ReservationGuestRequestDto extends PhoneIdentifierRequestDto {
  @ApiProperty({ example: 'Jane Doe', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string | null;
}
