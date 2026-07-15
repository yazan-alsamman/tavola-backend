import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  sessionId: string;
  sessionVersion: number;
  permissionsVersion: number;
  actorType: AccessTokenActorType;
  issuedAt: Date;
  serverTime: Date;
}
