import { SetMetadata } from '@nestjs/common';
import { RateLimitPolicyName } from '../../application/ports/auth-rate-limit-policy.port';

export const RATE_LIMIT_KEY = 'authRateLimitPolicy';

/**
 * Declares which named policy (AUTHENTICATION_ARCHITECTURE.md §8.3) applies
 * to a handler. Mirrors `@RequirePermission`'s shape: a plain metadata tag
 * read by `RateLimitGuard`, never a mechanism in its own right.
 */
export const RateLimit = (policy: RateLimitPolicyName): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, policy);
