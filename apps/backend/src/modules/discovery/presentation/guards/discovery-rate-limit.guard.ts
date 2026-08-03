import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Request } from 'express';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RateLimiterPort } from '@modules/authentication/domain/services/rate-limiter.port';
import { RateLimitExceededException } from '@modules/authentication/domain/exceptions/rate-limit-exceeded.exception';
import { resolveClientIp } from '@modules/authentication/presentation/utils/resolve-client-ip.util';
import { DiscoveryConfig } from '@config/discovery.config';
import { DISCOVERY_RATE_LIMITER } from '../../domain/tokens/discovery.tokens';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D12): public
 * Discovery endpoints must be rate-limited (ADR-018 §4), but this deliberately
 * does NOT extend Authentication's own closed `RateLimitPolicyName` union or
 * reuse its `RateLimitGuard` - that guard is keyed by a per-*named-policy*
 * strategy (login/register/forgotPassword/...) that structurally assumes an
 * Authentication-flow request shape (email/phone/refresh-token body fields)
 * and is owned by an unrelated bounded context. Discovery has exactly one
 * coherent tier applied uniformly (no per-route policy selection needed), so
 * this guard reuses only the underlying mechanism - the same
 * `RateLimiterPort`/`RedisSlidingWindowRateLimiter` Redis sliding-window
 * primitive, bound under Discovery's own `DISCOVERY_RATE_LIMITER` token
 * (`discovery.module.ts`) - not a second rate-limiting architecture, and not
 * a global `APP_GUARD`/`ThrottlerModule` either. Applied selectively via
 * `@UseGuards(DiscoveryRateLimitGuard)` on every `DiscoveryController` route,
 * exactly like Authentication's own guard is applied selectively.
 *
 * Keyed per client IP (SHA-256 hashed, same convention as `login`/`register`/
 * `resetPassword`) - the only identifier available for anonymous public
 * traffic. Redis failure semantics are deliberately unchanged from the reused
 * primitive: an outage propagates as an error (fails closed), matching
 * `RedisSlidingWindowRateLimiter`'s existing, unmodified behavior - no new
 * failure-handling branch is introduced here (D12).
 */
@Injectable()
export class DiscoveryRateLimitGuard implements CanActivate {
  constructor(
    @Inject(DISCOVERY_RATE_LIMITER) private readonly rateLimiter: RateLimiterPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const identifier = resolveClientIp(request);
    const config = this.configService.get<DiscoveryConfig>('discovery', { infer: true });
    if (!config) {
      throw new Error('Discovery configuration is not loaded.');
    }

    const key = `discovery:ratelimit:public:${hashValue(identifier)}`;
    const decision = await this.rateLimiter.consume(
      key,
      config.rateLimit.max,
      config.rateLimit.windowSeconds,
      new Date(),
    );

    if (!decision.allowed) {
      await this.auditLogWriter.record({
        actorId: null,
        actorType: 'User',
        action: 'discovery.rate_limit.exceeded',
        targetType: 'DiscoveryRateLimitPolicy',
        targetId: 'public',
        organizationId: null,
        correlationId: null,
        ipAddress: identifier,
        occurredAt: new Date(),
      });
      throw new RateLimitExceededException();
    }

    return true;
  }
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
