import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request } from 'express';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import {
  AuthRateLimitPolicyPort,
  AUTH_RATE_LIMIT_POLICY,
  RateLimitPolicyName,
} from '../../application/ports/auth-rate-limit-policy.port';
import { RateLimitExceededException } from '../../domain/exceptions/rate-limit-exceeded.exception';
import { RateLimiterPort } from '../../domain/services/rate-limiter.port';
import { RATE_LIMITER } from '../../domain/tokens/authentication.tokens';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';
import { resolveClientIp } from '../utils/resolve-client-ip.util';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '../../application/dto/authenticated-actor.dto';

type IdentifierStrategy = (request: Request) => string;

/**
 * Applied selectively via `@UseGuards`, exactly like `JwtAuthGuard` and
 * `PermissionsGuard` - never a global `APP_GUARD`. Runs before NestJS's
 * ValidationPipe, so it reads `request.body` raw (unvalidated) rather than a
 * typed DTO; this is intentional and safe here, since the guard only ever
 * reads a field to build a hash bucket, never to make a trust decision about
 * its content.
 *
 * Which field identifies "the caller" is a fixed, per-policy decision (not
 * configurable), because it encodes the actual attack this policy defends
 * against per AUTHENTICATION_ARCHITECTURE.md §8.2/§8.3:
 *  - login: per IP (credential stuffing/password spraying across accounts
 *    from one source).
 *  - forgotPassword: per email (forgot-password abuse against one victim
 *    account, regardless of source IP).
 *  - resetPassword: per IP. The architecture's table doesn't give this an
 *    explicit number, but §12.1 explicitly requires "rate limit" as a
 *    reset-token brute-force mitigation; no reliable non-IP identifier
 *    exists pre-validation (the token is opaque and may be wrong), so this
 *    reuses the login policy's IP-based numbers rather than inventing a new
 *    unreviewed number.
 *  - refresh: per presented refresh token (hashed). The architecture says
 *    "per session", but the session a token belongs to is only knowable
 *    after a database lookup inside the use case - hashing the token itself
 *    is the smallest Redis-only proxy available before that lookup, and
 *    still throttles the exact "refresh flooding" replay pattern §12.1 names.
 *  - register: per IP (5/hour/IP per §8.3's table) - registration abuse
 *    (mass account/organization creation) is a per-source-IP concern, same
 *    reasoning as login.
 *  - changePassword: per authenticated userId (not in §8.3's table - added in
 *    Phase 2.22's security audit). The threat here is a holder of a valid
 *    access token brute-forcing the *real* password via repeated wrong
 *    `currentPassword` guesses (e.g. a token stolen via XSS, valid until its
 *    ≤15min TTL expires) - same "reset token brute force" mitigation §12.1
 *    requires, but keyed per-victim-account like `forgotPassword` rather than
 *    per-IP, since the attacker already holds a valid session for that
 *    specific user and IP-based limiting would both be trivially bypassed
 *    (rotate IP, same stolen token) and incorrectly throttle unrelated users
 *    behind the same NAT/proxy. Reuses `resetPassword`'s numbers, same
 *    precedent that policy itself set. Requires this guard to run *after*
 *    `JwtAuthGuard` in the route's `@UseGuards(...)` order, so
 *    `AUTHENTICATED_ACTOR_KEY` is already populated on the request.
 */
const IDENTIFIER_STRATEGIES: Record<RateLimitPolicyName, IdentifierStrategy> = {
  login: (request) => resolveClientIp(request),
  resetPassword: (request) => resolveClientIp(request),
  register: (request) => resolveClientIp(request),
  forgotPassword: (request) => normalizeEmail((request.body as { email?: unknown })?.email),
  refresh: (request) =>
    rawStringOrUnknown((request.body as { refreshToken?: unknown })?.refreshToken),
  changePassword: (request) => {
    const actor = (request as unknown as Record<string, unknown>)[AUTHENTICATED_ACTOR_KEY] as
      AuthenticatedActor | undefined;
    return rawStringOrUnknown(actor?.userId);
  },
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiterPort,
    @Inject(AUTH_RATE_LIMIT_POLICY) private readonly policyPort: AuthRateLimitPolicyPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policyName = this.reflector.get<RateLimitPolicyName | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!policyName) {
      // A route wearing this guard always carries `@RateLimit(...)` too -
      // reaching here means the two were attached inconsistently, a coding
      // mistake to surface immediately rather than silently letting traffic
      // through unlimited.
      throw new Error('RateLimitGuard applied without a @RateLimit(...) policy.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const identifier = IDENTIFIER_STRATEGIES[policyName](request);
    const policy = this.policyPort.getPolicy(policyName);
    const key = `auth:ratelimit:${policyName}:${hashValue(identifier)}`;

    const decision = await this.rateLimiter.consume(
      key,
      policy.max,
      policy.windowSeconds,
      new Date(),
    );

    if (!decision.allowed) {
      await this.auditLogWriter.record({
        actorId: null,
        actorType: 'User',
        action: 'auth.rate_limit.exceeded',
        targetType: 'RateLimitPolicy',
        targetId: policyName,
        organizationId: null,
        correlationId: null,
        ipAddress: resolveClientIp(request),
        occurredAt: new Date(),
      });
      throw new RateLimitExceededException();
    }

    return true;
  }
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value.trim().toLowerCase() : 'unknown';
}

function rawStringOrUnknown(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
