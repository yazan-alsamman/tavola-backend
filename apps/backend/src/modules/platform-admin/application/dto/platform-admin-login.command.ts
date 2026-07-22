export interface PlatformAdminLoginCommand {
  email: string;
  password: string;
  ipAddress: string;
}

export interface PlatformAdminLoginResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
}
