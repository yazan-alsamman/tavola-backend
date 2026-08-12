import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Section 8 - required only when the invited email has no existing account
 * (the use case itself determines which branch applies; these fields are
 * simply ignored when an existing account is used instead). No `email`
 * field exists here by design - the invited email always comes from the
 * token, never the client (Section 8 "do not allow the client to replace
 * the invited email").
 */
export class AcceptOrganizationInvitationRequestDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  lastName?: string;

  @ApiPropertyOptional({
    description:
      'Required only for a first-time acceptance (no existing account for the invited email).',
  })
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password?: string;
}
