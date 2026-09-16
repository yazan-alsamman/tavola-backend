import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { PlatformAdminSessionRevokeReason } from '../../domain/enums/platform-admin.enums';
import { InvalidPlatformAdminRefreshTokenException } from '../../domain/exceptions/invalid-platform-admin-refresh-token.exception';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import {
  PlatformAdminSessionRepository,
  PLATFORM_ADMIN_SESSION_REPOSITORY,
} from '../../domain/repositories/platform-admin-session.repository';
import { PlatformAdminSessionIssuer } from '../services/platform-admin-session-issuer.service';
import {
  PlatformAdminRefreshCommand,
  PlatformAdminRefreshResult,
} from '../dto/platform-admin-refresh.command';

/**
 * Rotates a Platform Owner console session. Mirrors `RefreshSessionUseCase`'s
 * security model on the isolated Platform Admin pipeline:
 *
 *  1. The presented token is looked up by its SHA-256 digest. A hit on the
 *     *current* hash is an ordinary refresh.
 *  2. A hit on the *previous* hash means an already-rotated token was
 *     replayed. That is indistinguishable from token theft, so every live
 *     session for that admin is revoked — not merely the one replayed — and
 *     the attempt is audited. The legitimate holder is forced back through
 *     login, which is the correct outcome when one of the two parties
 *     holding the token is an attacker.
 *  3. Anything else is an invalid token.
 *
 * Every failure mode raises the identical exception, so the endpoint cannot
 * be used to probe whether a token was ever valid.
 *
 * The admin's live `PlatformAdmin` row is re-read on every refresh, so an
 * account revoked or demoted mid-session cannot refresh its way into a token
 * carrying stale authority — the same reason `PlatformAdminGuard` re-reads it
 * per request rather than trusting the JWT claim.
 */
@Injectable()
export class PlatformAdminRefreshUseCase {
  constructor(
    private readonly sessionIssuer: PlatformAdminSessionIssuer,
    @Inject(PLATFORM_ADMIN_SESSION_REPOSITORY)
    private readonly sessionRepository: PlatformAdminSessionRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: PlatformAdminRefreshCommand): Promise<PlatformAdminRefreshResult> {
    const presented = command.refreshToken?.trim();
    if (!presented) {
      throw new InvalidPlatformAdminRefreshTokenException();
    }

    const now = this.clock.now();
    const presentedHash = this.sessionIssuer.hashRefreshToken(presented);

    const session = await this.sessionRepository.findByRefreshTokenHash(presentedHash);
    if (session === null) {
      await this.handlePossibleReplay(presentedHash, command, now);
      throw new InvalidPlatformAdminRefreshTokenException();
    }

    if (!session.isActive(now)) {
      throw new InvalidPlatformAdminRefreshTokenException();
    }

    // Re-read live authority before minting anything.
    const authContext = await this.platformAdminRepository.findActiveAdminContext(
      session.platformAdminUserId,
    );
    if (authContext === null) {
      // The admin was revoked while holding a still-valid refresh token.
      // Close the session rather than leaving it to expire on its own.
      await this.sessionRepository.revokeById(
        session.sessionId,
        PlatformAdminSessionRevokeReason.Admin,
        now,
      );
      throw new InvalidPlatformAdminRefreshTokenException();
    }

    const newRefresh = this.sessionIssuer.generateRefreshToken();
    const refreshTokenExpiresAt = this.sessionIssuer.refreshExpiryFrom(now);

    const rotation = await this.sessionRepository.rotateIfHashMatches({
      presentedHash,
      newHash: newRefresh.hash,
      expiresAt: refreshTokenExpiresAt,
      now,
    });

    // A concurrent refresh already consumed this token. Not a replay (the
    // loser never received a token of its own), so no family revoke - just
    // an invalid-token response the console retries or re-authenticates on.
    if (rotation.status === 'hash_mismatch') {
      throw new InvalidPlatformAdminRefreshTokenException();
    }

    const { accessToken, accessTokenExpiresAt } = this.sessionIssuer.signAccessToken(
      session.platformAdminUserId,
      authContext.role,
      now,
    );

    return {
      accessToken,
      refreshToken: newRefresh.token,
      tokenType: 'Bearer',
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      platformAdminUserId: session.platformAdminUserId,
      role: authContext.role,
    };
  }

  private async handlePossibleReplay(
    presentedHash: string,
    command: PlatformAdminRefreshCommand,
    now: Date,
  ): Promise<void> {
    const replayed = await this.sessionRepository.findByPreviousRefreshTokenHash(presentedHash);
    if (replayed === null) {
      return;
    }

    await this.sessionRepository.revokeAllByPlatformAdminUserId(
      replayed.platformAdminUserId,
      PlatformAdminSessionRevokeReason.ReuseDetected,
      now,
    );

    await this.auditLogWriter.record({
      actorId: replayed.platformAdminUserId,
      actorType: 'PlatformAdmin',
      action: 'platform_admin.refresh.reuse_detected',
      targetType: 'PlatformAdminSession',
      targetId: replayed.sessionId,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress ?? null,
      occurredAt: now,
    });
  }
}
