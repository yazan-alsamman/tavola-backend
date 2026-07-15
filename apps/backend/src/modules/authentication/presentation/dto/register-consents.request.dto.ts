import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Transport-only shape check (booleans present). Whether `termsOfService`/
 * `privacyPolicy` are actually `true` is a business rule enforced by
 * `RegisterOrganizationOwnerUseCase` (`RegistrationConsentRequiredException`)
 * - not duplicated here, per this phase's "do not move business validation
 * into DTOs" instruction.
 */
export class RegisterConsentsRequestDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  termsOfService!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  privacyPolicy!: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;
}
