export interface SystemConfigurationPort {
  getNumber(key: string, defaultValue: number): Promise<number>;
  getString(key: string, defaultValue: string): Promise<string>;
}

export const SYSTEM_CONFIG_KEYS = {
  passwordResetTokenTtlHours: 'passwordResetTokenTtlHours',
  passwordHistoryCount: 'passwordHistoryCount',
  termsOfServiceVersion: 'termsOfServiceVersion',
  privacyPolicyVersion: 'privacyPolicyVersion',
  maxFailedLoginAttempts: 'maxFailedLoginAttempts',
  accountLockDurationMinutes: 'accountLockDurationMinutes',
  maxActiveSessionsPerUser: 'maxActiveSessionsPerUser',
  refreshTokenTtlDays: 'refreshTokenTtlDays',
  // ADR-022 (Phase 2.23) — frozen defaults (5 min / 5 attempts / 60s),
  // following the exact existing pattern of maxFailedLoginAttempts/
  // accountLockDurationMinutes: DB-seeded, business-configurable, not an
  // env var (env vars are reserved for rate-limit window/max pairs in this
  // repository's existing convention — see auth.config.ts).
  otpExpiryMinutes: 'otpExpiryMinutes',
  otpMaxIncorrectAttempts: 'otpMaxIncorrectAttempts',
  otpResendCooldownSeconds: 'otpResendCooldownSeconds',
} as const;
