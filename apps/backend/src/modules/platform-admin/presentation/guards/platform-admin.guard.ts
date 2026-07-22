import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
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
      throw new ForbiddenException('Platform Admin access required.');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new ForbiddenException('Platform Admin access required.');
    }

    let claims;
    try {
      claims = this.platformAdminTokenService.verifyAccessToken(token);
    } catch {
      throw new ForbiddenException('Platform Admin access required.');
    }

    // Live revocation/existence check - a still-unexpired token for an
    // admin whose PlatformAdmin row was later revoked (or never existed)
    // must not keep working.
    const isActive = await this.platformAdminRepository.isActiveAdmin(claims.sub);
    if (!isActive) {
      throw new ForbiddenException('Platform Admin access required.');
    }

    (request as unknown as Record<string, unknown>)[PLATFORM_ADMIN_ACTOR_KEY] = {
      userId: claims.sub,
    };

    return true;
  }
}
