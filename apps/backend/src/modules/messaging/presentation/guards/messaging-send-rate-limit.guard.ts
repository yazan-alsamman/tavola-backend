import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RateLimiterPort } from '@modules/authentication/domain/services/rate-limiter.port';
import { RateLimitExceededException } from '@modules/authentication/domain/exceptions/rate-limit-exceeded.exception';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { MessagingConfig } from '@config/messaging.config';
import { MESSAGING_RATE_LIMITER } from '../../domain/tokens/messaging.tokens';

/**
 * DECISIONS.md D8 - per-participant limit on `POST /conversations/:id/messages`
 * only, reusing the `RateLimiterPort`/`RedisSlidingWindowRateLimiter`
 * primitive under Messaging's own `MESSAGING_RATE_LIMITER` token, exactly
 * like `DiscoveryRateLimitGuard`'s own precedent - not a second rate-limiting
 * architecture. Keyed by the resolved actor id (`userId` for a Customer/
 * OrganizationMember, `employeeId` for an Employee) rather than IP, since
 * this route is always authenticated. Runs after `JwtAuthGuard` (must read
 * `request[AUTHENTICATED_ACTOR_KEY]`).
 */
@Injectable()
export class MessagingSendRateLimitGuard implements CanActivate {
  constructor(
    @Inject(MESSAGING_RATE_LIMITER) private readonly rateLimiter: RateLimiterPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const actor = (request as unknown as Record<string, unknown>)[AUTHENTICATED_ACTOR_KEY] as
      AuthenticatedActor | undefined;
    if (!actor) {
      // JwtAuthGuard did not run - fail closed, never an implicit allow.
      throw new RateLimitExceededException();
    }

    const config = this.configService.get<MessagingConfig>('messaging', { infer: true });
    if (!config) {
      throw new Error('Messaging configuration is not loaded.');
    }

    const participantKey =
      actor.actorType === AccessTokenActorType.Employee ? actor.employeeId : actor.userId;
    const key = `messaging:ratelimit:send:${participantKey}`;

    const decision = await this.rateLimiter.consume(
      key,
      config.sendRateLimit.max,
      config.sendRateLimit.windowSeconds,
      new Date(),
    );

    if (!decision.allowed) {
      await this.auditLogWriter.record({
        actorId: actor.userId,
        actorType: actor.actorType === AccessTokenActorType.Employee ? 'Employee' : 'User',
        action: 'messaging.rate_limit.exceeded',
        targetType: 'MessagingSendRateLimitPolicy',
        targetId: participantKey,
        organizationId: 'organizationId' in actor ? actor.organizationId : null,
        correlationId: null,
        ipAddress: null,
        occurredAt: new Date(),
      });
      throw new RateLimitExceededException();
    }

    return true;
  }
}
