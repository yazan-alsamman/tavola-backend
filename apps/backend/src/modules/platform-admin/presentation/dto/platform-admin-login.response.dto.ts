import { ApiProperty } from '@nestjs/swagger';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

/**
 * Returned by both `POST /platform-admin/login` and
 * `POST /platform-admin/refresh` - one shape, so a console needs a single
 * handler for "I have a fresh token pair" regardless of how it got there.
 */
export class PlatformAdminSessionResponseDto {
  @ApiProperty({
    description:
      'JWT access token, signed with the isolated Platform Admin issuer/audience. Send as `Authorization: Bearer <token>`.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZjE0...',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Opaque refresh token. Rotated on every use - the previous value is invalid immediately, and replaying it revokes every session for this admin. Shown exactly once; only its SHA-256 digest is stored.',
    example: 'qT7bZ1xK9wN4mR2hV6yD3sA8cF0eJ5gU',
  })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-09-15T10:15:00.000Z' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-09-22T10:00:00.000Z' })
  refreshTokenExpiresAt!: string;

  @ApiProperty({ format: 'uuid', example: '9f14c2a1-7b3e-4d58-9a6f-21c8e4b0d375' })
  platformAdminUserId!: string;

  @ApiProperty({ enum: PlatformAdminRole, example: PlatformAdminRole.PlatformAdmin })
  role!: PlatformAdminRole;
}

/**
 * Retained as a named alias so the existing `platformAdminLogin` operationId
 * keeps a stable response-schema name in the generated OpenAPI document.
 */
export class PlatformAdminLoginResponseDto extends PlatformAdminSessionResponseDto {}
