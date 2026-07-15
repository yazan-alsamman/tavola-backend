export enum UserStatus {
  Pending = 'Pending',
  Active = 'Active',
  Suspended = 'Suspended',
  Locked = 'Locked',
  Deleted = 'Deleted',
  Anonymized = 'Anonymized',
}

export enum DeviceType {
  Mobile = 'mobile',
  Web = 'web',
  Tablet = 'tablet',
  Unknown = 'unknown',
}

export enum SessionRevokeReason {
  Logout = 'logout',
  ReuseDetected = 'reuse_detected',
  PasswordChange = 'password_change',
  Admin = 'admin',
  Expired = 'expired',
  SessionVersionBump = 'session_version_bump',
}

export enum DeviceSessionStatus {
  Active = 'Active',
  Revoked = 'Revoked',
  Expired = 'Expired',
}
