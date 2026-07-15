export interface ChangePasswordResult {
  message: string;
  sessionVersion: number;
  accessToken: string;
  accessTokenExpiresAt: Date;
}
