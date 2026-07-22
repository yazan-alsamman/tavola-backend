/**
 * The named rate-limit policies this phase defines
 * (AUTHENTICATION_ARCHITECTURE.md §8.3). Each maps 1:1 to a `@RateLimit(name)`
 * decorator value on `AuthController` - the presentation layer never invents
 * limits itself, it only asks this port for the configured numbers.
 *
 * `changePassword` is not in §8.3's table (added in Phase 2.22's security
 * audit): a holder of a valid, not-yet-expired access token could otherwise
 * send unlimited `POST /auth/change-password` requests with guessed
 * `currentPassword` values with no lockout or rate limit at all - the same
 * reset-token-brute-force mitigation §12.1 requires applies equally here,
 * reusing `resetPassword`'s numbers per the same precedent that policy set.
 */
export type RateLimitPolicyName =
  | 'login'
  | 'refresh'
  | 'forgotPassword'
  | 'resetPassword'
  | 'register'
  | 'changePassword'
  // ADR-022 (Phase 2.23) — Customer phone-first registration/recovery.
  | 'customerRegisterSend'
  | 'customerRegisterVerify'
  | 'customerPasswordResetSend'
  | 'customerPasswordResetVerify';
// Customer login reuses the existing 'login' policy above (same IP-scoped
// brute-force rationale as Owner/staff login) rather than a new policy -
// ADR-022 does not freeze a distinct number for it.

export interface RateLimitPolicyConfig {
  readonly max: number;
  readonly windowSeconds: number;
}

export interface AuthRateLimitPolicyPort {
  getPolicy(name: RateLimitPolicyName): RateLimitPolicyConfig;
}

export const AUTH_RATE_LIMIT_POLICY = Symbol('AUTH_RATE_LIMIT_POLICY');
