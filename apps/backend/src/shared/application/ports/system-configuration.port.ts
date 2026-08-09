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
  // Phase 12 (Subscriptions, ADR-027 §38) — the one narrow scalar
  // SystemConfiguration entry this phase needs: which seeded SubscriptionPlan
  // slug is "the default" for automatic provisioning at Organization
  // creation (D7). SubscriptionPlan itself remains the authoritative source
  // of plan data (limits, entitlements) — this key never duplicates that.
  defaultSubscriptionPlanSlug: 'defaultSubscriptionPlanSlug',
  // Phase 20.X (ADR-014 execution) - the account-deletion grace period, in
  // days, before AnonymizeUserAccountUseCase's BullMQ job runs.
  anonymizationGracePeriodDays: 'anonymizationGracePeriodDays',
} as const;
