import { ApiProperty } from '@nestjs/swagger';

/**
 * ADR-025 delivery mechanism. Response of `GET /notifications/identity-token`.
 * Carries only the OneSignal-facing identity JWT and its lifetime - never any
 * Tavola session/authorization token, and never the signing key.
 */
export class OneSignalIdentityTokenResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Short-lived ES256 JWT for OneSignal.login()/updateUserJwt(). null when Identity Verification is not configured in this environment.',
  })
  token!: string | null;

  @ApiProperty({ example: 3600, description: 'Token lifetime in seconds.' })
  expiresInSeconds!: number;
}
