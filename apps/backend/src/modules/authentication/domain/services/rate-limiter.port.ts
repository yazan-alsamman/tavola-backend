/**
 * Framework-independent contract for an atomic, Redis-backed sliding-window
 * rate limiter (AUTHENTICATION_ARCHITECTURE.md §8.2/§8.3). `limit` and
 * `windowSeconds` are supplied by the caller per call (not read internally)
 * so this port stays a pure counting primitive - the policy (which limit
 * applies to which endpoint) lives in the application layer, not here.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Requests remaining in the current window after this call, floored at 0. */
  readonly remaining: number;
  /** When the current window fully drains if no further requests arrive. */
  readonly resetAt: Date;
}

export interface RateLimiterPort {
  consume(key: string, limit: number, windowSeconds: number, now: Date): Promise<RateLimitDecision>;
}
