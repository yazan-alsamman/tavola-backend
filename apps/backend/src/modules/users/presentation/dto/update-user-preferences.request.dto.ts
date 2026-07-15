import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Full-replace semantics, matching UpdateUserProfileRequestDto: both fields
 * are required so the caller always states the complete desired preference
 * state rather than a partial merge with ambiguous omitted-field meaning.
 */
export class UpdateUserPreferencesRequestDto {
  @ApiProperty({ example: true, description: 'Opt in to transactional/functional notifications' })
  @IsBoolean()
  notificationOptIn!: boolean;

  @ApiProperty({ example: false, description: 'Opt in to marketing communications' })
  @IsBoolean()
  marketingOptIn!: boolean;
}
