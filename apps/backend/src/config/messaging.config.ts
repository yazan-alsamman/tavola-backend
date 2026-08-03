import { registerAs } from '@nestjs/config';

/**
 * Phase 15.6 (Messaging, DECISIONS.md D8): per-participant rate limit on
 * `POST /conversations/:id/messages` only - reads are not rate-limited
 * beyond the standard global HTTP tier. Mirrors `discovery.config.ts`'s
 * env-overridable-with-frozen-default convention; a different threat model
 * (chat spam, not credential-guessing) so the numbers are not shared with
 * `auth.rateLimits` or `discovery.rateLimit`.
 */
export default registerAs('messaging', () => ({
  sendRateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MESSAGING_SEND_MAX ?? '30', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_MESSAGING_SEND_WINDOW_SECONDS ?? '60', 10),
  },
  cursorPagination: {
    defaultLimit: 50,
    maxLimit: 100,
  },
  idempotency: {
    ttlSeconds: parseInt(process.env.MESSAGING_IDEMPOTENCY_TTL_SECONDS ?? '86400', 10),
  },
}));

export interface MessagingConfig {
  sendRateLimit: {
    max: number;
    windowSeconds: number;
  };
  cursorPagination: {
    defaultLimit: number;
    maxLimit: number;
  };
  idempotency: {
    ttlSeconds: number;
  };
}
