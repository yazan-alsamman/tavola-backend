export interface PlatformAdminForceLogoutCommand {
  targetUserId: string;
  actorId: string;
  correlationId?: string;
}

export interface PlatformAdminResetCredentialsCommand {
  targetUserId: string;
  newPassword: string;
  actorId: string;
  correlationId?: string;
}

export interface PlatformAdminDisableLoginCommand {
  targetUserId: string;
  actorId: string;
  correlationId?: string;
}

export interface PlatformAdminEnableLoginCommand {
  targetUserId: string;
  actorId: string;
  correlationId?: string;
}
