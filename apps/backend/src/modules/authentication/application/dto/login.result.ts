import { UserStatus } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export interface LoginUserSnapshot {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  emailVerified: boolean;
}

export interface LoginOrganizationResult {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  user: LoginUserSnapshot;
  organization: LoginOrganizationResult | null;
  sessionId: string;
  sessionVersion: number;
  permissionsVersion: number;
  actorType: AccessTokenActorType;
  requiresPasswordChange: boolean;
}
