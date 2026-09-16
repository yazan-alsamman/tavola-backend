export interface PlatformAdminRefreshCommand {
  refreshToken: string;
  ipAddress?: string;
  correlationId?: string;
}

/**
 * Structurally identical to `PlatformAdminLoginResult` so a console can use
 * one response handler for both login and refresh. `refreshToken` is a
 * brand-new opaque token on every call - the presented one is consumed by
 * the rotation and is invalid from that point on.
 */
export interface PlatformAdminRefreshResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  platformAdminUserId: string;
  role: string;
}
