import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenExpiredError } from 'jsonwebtoken';
import type { Request } from 'express';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import {
  AuthenticatedActor,
  AUTHENTICATED_ACTOR_KEY,
} from '../../application/dto/authenticated-actor.dto';
import {
  ExpiredAccessTokenException,
  InvalidAccessTokenException,
  MissingAccessTokenException,
} from '../../application/exceptions/access-token.exceptions';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { TokenService } from '../../domain/services/token-service.port';
import { TOKEN_SERVICE } from '../../domain/tokens/authentication.tokens';
import { resolveClientIp } from '../utils/resolve-client-ip.util';

/**
 * Audits only genuinely invalid/expired *presented* tokens - not a missing
 * `Authorization` header (`MissingAccessTokenException`), which is the
 * overwhelmingly common, low-signal case for every unauthenticated request
 * (browser preflight, anonymous exploration) and isn't in this phase's
 * expected-actions list. A client that *had* a token that turned out
 * tampered/stale is the security-relevant signal worth persisting.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const authorization = request.headers as { authorization?: string } | undefined;
    const headerValue = authorization?.authorization;

    if (!headerValue || !headerValue.startsWith('Bearer ')) {
      throw new MissingAccessTokenException();
    }

    const token = headerValue.slice('Bearer '.length).trim();
    if (!token) {
      throw new MissingAccessTokenException();
    }

    try {
      const claims = this.tokenService.verifyAccessToken(token);

      const base = {
        userId: claims.sub,
        sessionId: claims.sessionId,
        sessionVersion: claims.sessionVersion,
        tokenFamilyId: claims.tokenFamilyId,
      };

      let actor: AuthenticatedActor;
      switch (claims.actorType) {
        case AccessTokenActorType.User:
          actor = { ...base, actorType: AccessTokenActorType.User };
          break;

        case AccessTokenActorType.Employee:
          actor = {
            ...base,
            actorType: AccessTokenActorType.Employee,
            employeeId: claims.employeeId,
            organizationId: claims.organizationId,
            restaurantId: claims.restaurantId,
            branchIds: claims.branchIds,
            permissions: claims.permissions,
            permissionsVersion: claims.permissionsVersion,
          };
          break;

        case AccessTokenActorType.OrganizationMember:
          actor = {
            ...base,
            actorType: AccessTokenActorType.OrganizationMember,
            organizationId: claims.organizationId,
            orgRole: claims.orgRole,
            permissionsVersion: claims.permissionsVersion,
          };
          break;

        default:
          // PlatformAdmin claims are not yet issuable by any use case; see
          // authenticated-actor.dto.ts for why no request-actor shape exists
          // for them yet.
          throw new InvalidAccessTokenException();
      }

      request[AUTHENTICATED_ACTOR_KEY] = actor;
      return true;
    } catch (error) {
      const resolved = this.resolveAuthError(error);

      if (
        resolved instanceof InvalidAccessTokenException ||
        resolved instanceof ExpiredAccessTokenException
      ) {
        await this.auditLogWriter.record({
          actorId: null,
          actorType: 'User',
          action:
            resolved instanceof ExpiredAccessTokenException
              ? 'auth.jwt.expired'
              : 'auth.jwt.invalid',
          targetType: null,
          targetId: null,
          organizationId: null,
          correlationId: null,
          ipAddress: resolveClientIp(request as unknown as Request),
          occurredAt: new Date(),
        });
      }

      throw resolved;
    }
  }

  /** Reproduces the guard's existing error-classification logic without
   *  throwing directly, so `canActivate` can audit-log before the resolved
   *  exception is actually thrown. Behavior is unchanged from before this
   *  phase - only the control flow was restructured. */
  private resolveAuthError(
    error: unknown,
  ): MissingAccessTokenException | InvalidAccessTokenException | ExpiredAccessTokenException {
    if (
      error instanceof MissingAccessTokenException ||
      error instanceof InvalidAccessTokenException ||
      error instanceof ExpiredAccessTokenException
    ) {
      return error;
    }

    if (error instanceof UnauthorizedException) {
      const cause = (error as { cause?: unknown }).cause ?? error;
      if (cause instanceof TokenExpiredError) {
        return new ExpiredAccessTokenException();
      }
      return new InvalidAccessTokenException();
    }

    if (error instanceof TokenExpiredError) {
      return new ExpiredAccessTokenException();
    }

    return new InvalidAccessTokenException();
  }
}
