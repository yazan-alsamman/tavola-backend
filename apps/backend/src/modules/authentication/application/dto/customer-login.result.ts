import { UserStatus } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export interface CustomerLoginUserSnapshot {
  userId: string;
  username: string;
  phone: string;
  status: UserStatus;
}

export interface CustomerLoginResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  user: CustomerLoginUserSnapshot;
  sessionId: string;
  sessionVersion: number;
  permissionsVersion: number;
  actorType: AccessTokenActorType;
}
