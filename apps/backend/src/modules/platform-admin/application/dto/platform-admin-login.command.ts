export interface PlatformAdminLoginCommand {
  email: string;
  password: string;
  ipAddress: string;
  userAgent?: string;
}

/**
 * `refreshToken` is the opaque plaintext — returned exactly once, at issue
 * time, and never recoverable afterwards (only its SHA-256 digest is
 * persisted). `tokenType` is echoed so a console can construct the
 * `Authorization` header without hardcoding the scheme, matching
 * `RefreshSessionResult`'s own shape on the tenant pipeline.
 */
export interface PlatformAdminLoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  platformAdminUserId: string;
  role: string;
}
