import { ApiProperty } from '@nestjs/swagger';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export class RefreshSessionResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ description: 'New opaque refresh token (single use until next refresh)' })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ type: String, format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  refreshTokenExpiresAt!: string;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ example: 1 })
  sessionVersion!: number;

  @ApiProperty({ example: 1 })
  permissionsVersion!: number;

  @ApiProperty({ enum: AccessTokenActorType, example: AccessTokenActorType.User })
  actorType!: AccessTokenActorType;

  @ApiProperty({ type: String, format: 'date-time' })
  issuedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  serverTime!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'ADR-025: short-lived OneSignal Identity-Verification JWT for OneSignal.login()/updateUserJwt(). Present only for Customer (User) actors; null otherwise or when Identity Verification is not configured.',
  })
  onesignalIdentityToken!: string | null;
}
