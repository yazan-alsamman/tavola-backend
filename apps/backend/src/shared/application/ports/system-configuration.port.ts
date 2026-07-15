export interface SystemConfigurationPort {
  getNumber(key: string, defaultValue: number): Promise<number>;
  getString(key: string, defaultValue: string): Promise<string>;
}

export const SYSTEM_CONFIG_KEYS = {
  emailVerificationTokenTtlHours: 'emailVerificationTokenTtlHours',
  passwordResetTokenTtlHours: 'passwordResetTokenTtlHours',
  passwordHistoryCount: 'passwordHistoryCount',
  termsOfServiceVersion: 'termsOfServiceVersion',
  privacyPolicyVersion: 'privacyPolicyVersion',
  maxFailedLoginAttempts: 'maxFailedLoginAttempts',
  accountLockDurationMinutes: 'accountLockDurationMinutes',
  maxActiveSessionsPerUser: 'maxActiveSessionsPerUser',
  refreshTokenTtlDays: 'refreshTokenTtlDays',
} as const;
