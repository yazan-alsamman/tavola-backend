/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D12): a
 * Discovery-scoped rate-limiter DI token. Bound to a fresh instance of the
 * same `RedisSlidingWindowRateLimiter` class Authentication already uses
 * (reusing the algorithm/primitive) - deliberately not Authentication's own
 * `RATE_LIMITER` token/`RateLimitPolicyName` registry, to avoid coupling this
 * unrelated bounded context into Authentication's policy registry (see
 * `DiscoveryRateLimitGuard`'s own doc comment).
 */
export const DISCOVERY_RATE_LIMITER = Symbol('DISCOVERY_RATE_LIMITER');
