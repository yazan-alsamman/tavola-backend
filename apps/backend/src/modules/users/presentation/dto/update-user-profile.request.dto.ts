import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/**
 * Full-replace semantics, not partial-merge: every field is required except
 * the ones already nullable in the domain (`phone` - represented here as the
 * `countryCode`/`phoneNumber` pair, see below - and `preferredCurrency`).
 * Avoids the "unsafe partial update" pitfall of a PATCH DTO where omitted
 * fields have ambiguous meaning (keep existing value? clear it?) - the
 * caller always states the complete desired profile, and the use case never
 * has to merge partial input against existing state.
 */
export class UpdateUserProfileRequestDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  /**
   * ADR-022 Decision #13: the backend never trusts a client-assembled E.164
   * string as a fresh phone submission - every Customer phone-input endpoint
   * (registration, login, password recovery) takes `countryCode` +
   * `phoneNumber` separately and re-derives canonical E.164 server-side via
   * `PhoneNumber.create()`. This endpoint previously accepted a raw `phone`
   * string directly, which was inconsistent with that rule; both fields must
   * be supplied together to set a phone, or both omitted/null to clear it.
   */
  @ApiPropertyOptional({
    description:
      'ISO 3166-1 alpha-2 country code, required together with phoneNumber to set a phone; omit both to clear it',
    example: 'SY',
    nullable: true,
  })
  @ValidateIf(
    (dto: UpdateUserProfileRequestDto) => dto.phoneNumber !== undefined && dto.phoneNumber !== null,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string | null;

  @ApiPropertyOptional({
    description: 'National/local phone number, entered separately from the country selection',
    example: '0912345678',
    nullable: true,
  })
  @ValidateIf(
    (dto: UpdateUserProfileRequestDto) => dto.countryCode !== undefined && dto.countryCode !== null,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber?: string | null;

  @ApiProperty({ example: 'en', description: 'ISO 639-1 two-letter language code' })
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'language must be a two-letter ISO 639-1 code' })
  language!: string;

  @ApiPropertyOptional({
    example: 'USD',
    nullable: true,
    description: 'ISO 4217 three-letter currency code',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'preferredCurrency must be a three-letter ISO 4217 code' })
  preferredCurrency?: string | null;
}
