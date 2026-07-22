import { registerAs } from '@nestjs/config';

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

export function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  const match = DURATION_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration format: "${value}". Expected e.g. 15m, 30d, 1h.`);
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3_600;
    case 'd':
      return amount * 86_400;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}

export default registerAs('auth', () => ({
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  jwtAccessSecretPrevious: process.env.JWT_ACCESS_SECRET_PREVIOUS ?? '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  jwtAccessExpirySeconds: parseDurationToSeconds(process.env.JWT_ACCESS_EXPIRY ?? '15m'),
  jwtRefreshExpirySeconds: parseDurationToSeconds(process.env.JWT_REFRESH_EXPIRY ?? '30d'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'tavla-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'tavla-clients',
  argon2MemoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '65536', 10),
  argon2TimeCost: parseInt(process.env.ARGON2_TIME_COST ?? '3', 10),
  argon2Parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '1', 10),
  refreshConcurrentGraceMs: parseInt(process.env.REFRESH_CONCURRENT_GRACE_MS ?? '30000', 10),
  rateLimits: {
    login: {
      max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX ?? '10', 10),
      windowSeconds: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_SECONDS ?? '900', 10),
    },
    refresh: {
      max: parseInt(process.env.RATE_LIMIT_REFRESH_MAX ?? '30', 10),
      windowSeconds: parseInt(process.env.RATE_LIMIT_REFRESH_WINDOW_SECONDS ?? '60', 10),
    },
    forgotPassword: {
      max: parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX ?? '3', 10),
      windowSeconds: parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS ?? '3600', 10),
    },
    resetPassword: {
      max: parseInt(process.env.RATE_LIMIT_RESET_PASSWORD_MAX ?? '10', 10),
      windowSeconds: parseInt(process.env.RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS ?? '900', 10),
    },
    register: {
      max: parseInt(process.env.RATE_LIMIT_REGISTER_MAX ?? '5', 10),
      windowSeconds: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_SECONDS ?? '3600', 10),
    },
    changePassword: {
      max: parseInt(process.env.RATE_LIMIT_CHANGE_PASSWORD_MAX ?? '10', 10),
      windowSeconds: parseInt(process.env.RATE_LIMIT_CHANGE_PASSWORD_WINDOW_SECONDS ?? '900', 10),
    },
    // ADR-022 (Phase 2.23) — Customer phone-first registration/recovery.
    customerRegisterSend: {
      max: parseInt(process.env.RATE_LIMIT_CUSTOMER_REGISTER_SEND_MAX ?? '5', 10),
      windowSeconds: parseInt(
        process.env.RATE_LIMIT_CUSTOMER_REGISTER_SEND_WINDOW_SECONDS ?? '3600',
        10,
      ),
    },
    customerRegisterVerify: {
      max: parseInt(process.env.RATE_LIMIT_CUSTOMER_REGISTER_VERIFY_MAX ?? '10', 10),
      windowSeconds: parseInt(
        process.env.RATE_LIMIT_CUSTOMER_REGISTER_VERIFY_WINDOW_SECONDS ?? '900',
        10,
      ),
    },
    customerPasswordResetSend: {
      max: parseInt(process.env.RATE_LIMIT_CUSTOMER_PASSWORD_RESET_SEND_MAX ?? '5', 10),
      windowSeconds: parseInt(
        process.env.RATE_LIMIT_CUSTOMER_PASSWORD_RESET_SEND_WINDOW_SECONDS ?? '3600',
        10,
      ),
    },
    customerPasswordResetVerify: {
      max: parseInt(process.env.RATE_LIMIT_CUSTOMER_PASSWORD_RESET_VERIFY_MAX ?? '10', 10),
      windowSeconds: parseInt(
        process.env.RATE_LIMIT_CUSTOMER_PASSWORD_RESET_VERIFY_WINDOW_SECONDS ?? '900',
        10,
      ),
    },
  },
}));

export interface AuthRateLimitPolicyConfig {
  max: number;
  windowSeconds: number;
}

export interface AuthConfig {
  jwtAccessSecret: string;
  jwtAccessSecretPrevious: string;
  jwtRefreshSecret: string;
  jwtAccessExpirySeconds: number;
  jwtRefreshExpirySeconds: number;
  jwtIssuer: string;
  jwtAudience: string;
  argon2MemoryCost: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  refreshConcurrentGraceMs: number;
  rateLimits: {
    login: AuthRateLimitPolicyConfig;
    refresh: AuthRateLimitPolicyConfig;
    forgotPassword: AuthRateLimitPolicyConfig;
    resetPassword: AuthRateLimitPolicyConfig;
    register: AuthRateLimitPolicyConfig;
    changePassword: AuthRateLimitPolicyConfig;
    customerRegisterSend: AuthRateLimitPolicyConfig;
    customerRegisterVerify: AuthRateLimitPolicyConfig;
    customerPasswordResetSend: AuthRateLimitPolicyConfig;
    customerPasswordResetVerify: AuthRateLimitPolicyConfig;
  };
}
