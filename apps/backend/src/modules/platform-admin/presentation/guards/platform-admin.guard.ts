import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  UnauthorizedException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  PlatformAdminTokenService,
  PLATFORM_ADMIN_TOKEN_SERVICE,
} from '../../domain/services/platform-admin-token.port';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PLATFORM_ADMIN_ACTOR_KEY } from '../../application/dto/platform-admin-actor.dto';

/**
 * ADR-022 §"Platform Admin Authentication" (Phase 2.23 closure, approved
 * decision) — deliberately does NOT run after `JwtAuthGuard` and does NOT
 * read `AuthenticatedActor`/`AUTHENTICATED_ACTOR_KEY`. It extracts and
 * verifies the Bearer token itself, exclusively via
 * `PlatformAdminTokenService` (separate secret/issuer/audience,
 * `JwtPlatformAdminTokenService`). This is the whole point of the
 * isolation: an ordinary Customer/Owner/Employee/OrganizationMember access
 * token — however it was produced, even one carrying a forged
 * `actorType: PlatformAdmin` claim — is signed for a different issuer/
 * audience under the ordinary `JWT_ACCESS_SECRET` and fails verification
 * here outright, before any claim is ever inspected.
 *
 * **401 vs 403.** This guard originally answered 403 for every rejection,
 * which made "your token expired" and "your account no longer has this
 * authority" indistinguishable to a client. A console cannot act on that: it
 * has no way to tell a recoverable state (refresh the token) from a terminal
 * one (stop retrying, the admin was revoked), so it is pushed into guessing
 * from the JWT's `exp` client-side. The two are now separated:
 *
 *  - **401** — no credential was usable: header missing, not `Bearer`, empty,
 *    malformed, expired, or signed for the wrong secret/issuer/audience.
 *    Nothing was authenticated, so there is nothing to authorize. The client
 *    should refresh, then re-authenticate.
 *  - **403** — a valid, verified token whose subject is not (or is no longer)
 *    an active `PlatformAdmin`. Identity is established; authority is not.
 *    Refreshing cannot help.
 *
 * Tier checks (`PlatformAdminRoleGuard`) stay 403 for the same reason: the
 * caller is authenticated, just not permitted.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(PLATFORM_ADMIN_TOKEN_SERVICE)
    private readonly platformAdminTokenService: PlatformAdminTokenService,
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Platform Admin authentication required.');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Platform Admin authentication required.');
    }

    let claims;
    try {
      claims = this.platformAdminTokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Platform Admin authentication required.');
    }

    // Live revocation/existence check - a still-unexpired token for an
    // admin whose PlatformAdmin row was later revoked (or never existed)
    // must not keep working. Phase 19.1 (ADR-034 §11-12): also re-verifies
    // `role` against the live row on every request rather than trusting the
    // JWT claim alone, so a role demotion (or revocation) takes effect
    // immediately, not merely on next login.
    const authContext = await this.platformAdminRepository.findActiveAdminContext(claims.sub);
    if (!authContext) {
      throw new ForbiddenException('Platform Admin access required.');
    }

    (request as unknown as Record<string, unknown>)[PLATFORM_ADMIN_ACTOR_KEY] = {
      userId: claims.sub,
      role: authContext.role,
    };

    return true;
  }
}
