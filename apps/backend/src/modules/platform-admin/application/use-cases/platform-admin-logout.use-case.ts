import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { PlatformAdminSessionRevokeReason } from '../../domain/enums/platform-admin.enums';
import {
  PlatformAdminSessionRepository,
  PLATFORM_ADMIN_SESSION_REPOSITORY,
} from '../../domain/repositories/platform-admin-session.repository';
import { PlatformAdminSessionIssuer } from '../services/platform-admin-session-issuer.service';
import { PlatformAdminLogoutCommand } from '../dto/platform-admin-logout.command';

/**
 * Ends one Platform Owner console session by revoking its
 * `PlatformAdminSession` row, so the refresh token dies immediately rather
 * than remaining usable until its sliding expiry. The already-issued access
 * token stays valid for the remainder of its (900s default) lifetime - the
 * same property `POST /auth/logout` has on the tenant pipeline, and an
 * inherent consequence of stateless JWT verification. Bounding that window
 * is the access token's short TTL, not this endpoint.
 *
 * Deliberately idempotent and non-enumerating: an unknown, already-revoked,
 * expired, or someone-else's refresh token all return 204 and reveal
 * nothing. A logout that reports "no such session" would let an
 * unauthenticated-in-practice caller test tokens; a logout that errors on
 * an already-dead session would make a retried request fail for no reason.
 * The only thing that actually varies is whether a revocation is recorded.
 */
@Injectable()
export class PlatformAdminLogoutUseCase {
  constructor(
    private readonly sessionIssuer: PlatformAdminSessionIssuer,
    @Inject(PLATFORM_ADMIN_SESSION_REPOSITORY)
    private readonly sessionRepository: PlatformAdminSessionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: PlatformAdminLogoutCommand): Promise<void> {
    const presented = command.refreshToken?.trim();
    if (!presented) {
      return;
    }

    const now = this.clock.now();
    const session = await this.sessionRepository.findByRefreshTokenHash(
      this.sessionIssuer.hashRefreshToken(presented),
    );

    // Ownership check: a valid refresh token belonging to a *different*
    // admin must not be revocable by this caller. Silently ignored rather
    // than rejected, for the non-enumeration reason above.
    if (session === null || session.platformAdminUserId !== command.actorId) {
      return;
    }

    if (session.isRevoked()) {
      return;
    }

    await this.sessionRepository.revokeById(
      session.sessionId,
      PlatformAdminSessionRevokeReason.Logout,
      now,
    );

    await this.auditLogWriter.record({
      actorId: command.actorId,
      actorType: 'PlatformAdmin',
      action: 'platform_admin.logout',
      targetType: 'PlatformAdminSession',
      targetId: session.sessionId,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress ?? null,
      occurredAt: now,
    });
  }
}
