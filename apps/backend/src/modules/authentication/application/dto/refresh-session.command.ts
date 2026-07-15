export interface RefreshSessionCommand {
  refreshToken: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}
