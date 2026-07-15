import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RegisterConsentsRequestDto } from './register-consents.request.dto';

/**
 * Matches AUTHENTICATION_ARCHITECTURE.md §9.2's documented `/auth/register`
 * request exactly, with one deliberate, disclosed narrowing: `intent` only
 * accepts `'owner'`. `RegisterOrganizationOwnerUseCase` (Phase 2.5) is the
 * only registration use case that exists - there is no customer-registration
 * use case yet to route an `intent: 'customer'` request to. Rejecting any
 * other value with a standard validation error is honest about current
 * capability rather than silently accepting and ignoring it, and is a
 * transport-level constraint (which values this endpoint currently
 * supports), not new business logic.
 *
 * Only transport concerns are validated here (types/lengths/formats/
 * required fields) - password strength, email uniqueness, consent
 * acceptance, and organization slug availability are all re-validated (and
 * are the actual source of truth) inside the domain/application layer via
 * `Password`/`Email`/`OrganizationSlug` value objects and
 * `RegisterOrganizationOwnerUseCase.validateCommand`.
 */
export class RegisterRequestDto {
  @ApiProperty({ enum: ['owner'], example: 'owner' })
  @IsIn(['owner'])
  intent!: 'owner';

  @ApiProperty({
    description: 'Email address to register the account with',
    example: 'owner@example.com',
  })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

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

  @ApiPropertyOptional({ example: '+963900000000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ example: 'Acme Restaurant Group' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  organizationName!: string;

  @ApiProperty({ type: () => RegisterConsentsRequestDto })
  @ValidateNested()
  @Type(() => RegisterConsentsRequestDto)
  consents!: RegisterConsentsRequestDto;
}
