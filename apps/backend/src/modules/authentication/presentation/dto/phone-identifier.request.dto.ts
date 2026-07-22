import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Shared transport-only shape (ADR-022): every Customer registration/login/
 * password-recovery endpoint identifies the phone the same way -
 * `countryCode` (ISO 3166-1 alpha-2, mobile Country Code Picker selection,
 * default "SY" in the mobile UI only, never assumed here) + `phoneNumber`
 * (national/local number). Extended, not duplicated, by each endpoint's own
 * request DTO.
 */
export class PhoneIdentifierRequestDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code selected in the Country Code Picker',
    example: 'SY',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode!: string;

  @ApiProperty({
    description: 'National/local phone number, entered separately from the country selection',
    example: '0912345678',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber!: string;
}
