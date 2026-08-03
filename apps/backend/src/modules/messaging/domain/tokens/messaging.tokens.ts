/**
 * Phase 15.6 (Messaging, DECISIONS.md D8): a Messaging-scoped rate-limiter DI
 * token, bound to a fresh instance of the same `RedisSlidingWindowRateLimiter`
 * class Authentication/Discovery already use (reusing the algorithm/
 * primitive) - not Authentication's own `RATE_LIMITER` token/
 * `RateLimitPolicyName` registry, mirroring `DISCOVERY_RATE_LIMITER`'s own
 * precedent exactly.
 */
export const MESSAGING_RATE_LIMITER = Symbol('MESSAGING_RATE_LIMITER');

/**
 * DECISIONS.md D12 - no generic `Idempotency-Key` handling existed anywhere
 * in this codebase before Phase 15.6. Backed by the same Redis connection
 * `RateLimiterPort` already uses (reuses existing infrastructure, not a new
 * subsystem).
 */
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/**
 * DECISIONS.md D7 - resolves to `storage.privateBucket` (MinIO), unlike
 * Review images' public bucket: a chat attachment is only ever readable by
 * the conversation's own participants via a signed URL, never public
 * gallery content.
 */
export const MESSAGE_ATTACHMENTS_BUCKET = Symbol('MESSAGE_ATTACHMENTS_BUCKET');
