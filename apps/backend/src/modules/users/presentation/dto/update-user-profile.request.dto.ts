import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Full-replace semantics, not partial-merge: every field is required except
 * the ones already nullable in the domain (`phone`, `preferredCurrency`).
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

  @ApiPropertyOptional({ example: '+963900000000', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

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
