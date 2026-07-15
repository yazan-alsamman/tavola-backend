import { ApiProperty } from '@nestjs/swagger';

/**
 * Explicit response allowlist - notificationOptIn/marketingOptIn only.
 * language/preferredCurrency stay on UserProfileResponseDto (Phase 3.1);
 * never duplicated here.
 */
export class UserPreferencesResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiProperty({ example: true })
  notificationOptIn!: boolean;

  @ApiProperty({ example: false })
  marketingOptIn!: boolean;

  @ApiProperty({ example: '2026-07-15T12:00:00.000Z' })
  updatedAt!: string;
}
