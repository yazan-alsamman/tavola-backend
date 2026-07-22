import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Explicit response allowlist - never re-exposes passwordHash, status,
 * emailVerified, sessionVersion/permissionsVersion, or any other
 * Authentication-internal field, even though the underlying User aggregate
 * carries them.
 */
export class UserProfileResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiPropertyOptional({ example: 'Jane', nullable: true })
  firstName!: string | null;

  @ApiPropertyOptional({ example: 'Doe', nullable: true })
  lastName!: string | null;

  @ApiPropertyOptional({ example: 'jane.doe@example.com', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ example: '+963900000000', nullable: true })
  phone!: string | null;

  @ApiProperty({ example: 'en' })
  language!: string;

  @ApiPropertyOptional({ example: 'USD', nullable: true })
  preferredCurrency!: string | null;

  @ApiProperty({ example: '2026-07-07T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-07T12:00:00.000Z' })
  updatedAt!: string;
}
