import { ConfigService } from '@nestjs/config';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { PlatformAdminRefreshUseCase } from './platform-admin-refresh.use-case';
import { PlatformAdminLogoutUseCase } from './platform-admin-logout.use-case';
import { PlatformAdminSessionIssuer } from '../services/platform-admin-session-issuer.service';
import { JwtPlatformAdminTokenService } from '../../infrastructure/security/jwt-platform-admin-token.service';
import {
  PlatformAdminRole,
  PlatformAdminSessionRevokeReason,
} from '../../domain/enums/platform-admin.enums';
import { InvalidPlatformAdminRefreshTokenException } from '../../domain/exceptions/invalid-platform-admin-refresh-token.exception';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { InMemoryPlatformAdminSessionRepository } from '../../../../../test/platform-admin/support/in-memory-platform-admin-session.repository';
import {
  CollectingAuditLogWriter,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('Platform Admin session lifecycle', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');
  const adminUserId = '11111111-1111-4111-8111-111111111111';
  const otherAdminUserId = '99999999-9999-4999-8999-999999999999';
  const sessionId = '22222222-2222-4222-8222-222222222222';

  const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  class FakePlatformAdminRepository implements PlatformAdminRepository {
    constructor(private readonly activeAdminIds: Set<string> = new Set([adminUserId])) {}
    async findActiveAdminContext(userId: string): Promise<PlatformAdminAuthContext | null> {
      return this.activeAdminIds.has(userId) ? { role: PlatformAdminRole.PlatformAdmin } : null;
    }
    findById(): Promise<PlatformAdminRecord | null> {
      throw new Error('Not needed by this suite.');
    }
    findByUserId(): Promise<PlatformAdminRecord | null> {
      throw new Error('Not needed by this suite.');
    }
    list(): Promise<PlatformAdminListPage> {
      throw new Error('Not needed by this suite.');
    }
    create(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    updateRole(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    revoke(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    reactivate(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
  }

  function buildConfigService(): ConfigService {
    return {
      get: () => ({
        jwtSecret: 'platform-admin-secret-at-least-32-characters-long',
        jwtIssuer: 'tavla-platform-admin',
        jwtAudience: 'tavla-platform-admin-clients',
        jwtExpirySeconds: 900,
        refreshExpiryDays: 7,
      }),
    } as unknown as ConfigService;
  }

  function build(options?: { activeAdminIds?: Set<string> }) {
    const config = buildConfigService();
    const sessionRepository = new InMemoryPlatformAdminSessionRepository();
    const platformAdminRepository = new FakePlatformAdminRepository(options?.activeAdminIds);
    const auditLogWriter = new CollectingAuditLogWriter();
    const clock = new FixedClock(now);

    // The real hashing service, so "only the digest is stored" is genuinely
    // exercised rather than asserted against a stub.
    const issuer = new PlatformAdminSessionIssuer(
      config,
      new JwtPlatformAdminTokenService(config),
      sessionRepository,
      new Sha256OpaqueTokenService(),
      new SequentialIdGenerator([sessionId, sessionId, sessionId, sessionId]),
    );

    return {
      issuer,
      sessionRepository,
      auditLogWriter,
      refresh: new PlatformAdminRefreshUseCase(
        issuer,
        sessionRepository,
        platformAdminRepository,
        clock,
        auditLogWriter,
      ),
      logout: new PlatformAdminLogoutUseCase(issuer, sessionRepository, clock, auditLogWriter),
    };
  }

  async function openSession(
    issuer: PlatformAdminSessionIssuer,
    userId = adminUserId,
  ): Promise<string> {
    const issued = await issuer.issueForNewSession({
      platformAdminUserId: userId,
      role: PlatformAdminRole.PlatformAdmin,
      ipAddress: '203.0.113.10',
      userAgent: 'jest',
      now,
    });
    return issued.refreshToken;
  }

  describe('refresh', () => {
    it('rotates the token, extends the sliding expiry, and issues a new access token', async () => {
      const { issuer, sessionRepository, refresh } = build();
      const original = await openSession(issuer);

      const result = await refresh.execute({ refreshToken: original });

      expect(result.refreshToken).not.toBe(original);
      expect(result.tokenType).toBe('Bearer');
      expect(result.role).toBe(PlatformAdminRole.PlatformAdmin);
      expect(result.platformAdminUserId).toBe(adminUserId);
      expect(result.refreshTokenExpiresAt.getTime()).toBe(now.getTime() + REFRESH_TTL_MS);

      // Rotation is in place: one session, carrying the presented token as
      // its `previous` value so a later replay stays detectable.
      expect(sessionRepository.sessions).toHaveLength(1);
      const [session] = sessionRepository.sessions;
      expect(session.previousRefreshTokenHash).toBe(issuer.hashRefreshToken(original));
      expect(session.refreshTokenHash).toBe(issuer.hashRefreshToken(result.refreshToken));
    });

    it('rejects the presented token once it has been rotated away', async () => {
      const { issuer, refresh } = build();
      const original = await openSession(issuer);

      await refresh.execute({ refreshToken: original });

      await expect(refresh.execute({ refreshToken: original })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );
    });

    it('revokes every session for the admin when an already-rotated token is replayed', async () => {
      const { issuer, sessionRepository, auditLogWriter, refresh } = build();
      const original = await openSession(issuer);
      // A second, independent console session for the same admin.
      await openSession(issuer);
      await refresh.execute({ refreshToken: original });

      await expect(refresh.execute({ refreshToken: original })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );

      // Replay is indistinguishable from theft, so the blast radius is every
      // session that admin holds - not just the one replayed.
      expect(sessionRepository.sessions).toHaveLength(2);
      for (const session of sessionRepository.sessions) {
        expect(session.isRevoked()).toBe(true);
        expect(session.toProps().revokedReason).toBe(
          PlatformAdminSessionRevokeReason.ReuseDetected,
        );
      }
      expect(
        auditLogWriter.entries.some(
          (entry) => entry.action === 'platform_admin.refresh.reuse_detected',
        ),
      ).toBe(true);
    });

    it('does not revoke a different admin sessions on replay', async () => {
      const { issuer, sessionRepository, refresh } = build({
        activeAdminIds: new Set([adminUserId, otherAdminUserId]),
      });
      const original = await openSession(issuer);
      const otherToken = await openSession(issuer, otherAdminUserId);
      await refresh.execute({ refreshToken: original });

      await expect(refresh.execute({ refreshToken: original })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );

      const otherSession = sessionRepository.sessions.find(
        (session) => session.platformAdminUserId === otherAdminUserId,
      );
      expect(otherSession?.isRevoked()).toBe(false);
      await expect(refresh.execute({ refreshToken: otherToken })).resolves.toBeDefined();
    });

    it('rejects an unknown token without revoking anything', async () => {
      const { issuer, sessionRepository, refresh } = build();
      await openSession(issuer);

      await expect(refresh.execute({ refreshToken: 'not-a-real-token' })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );
      expect(sessionRepository.sessions[0].isRevoked()).toBe(false);
    });

    it('rejects an empty token', async () => {
      const { refresh } = build();

      await expect(refresh.execute({ refreshToken: '   ' })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );
    });

    it('closes the session and refuses to refresh once the admin grant is revoked', async () => {
      // The admin was deactivated while still holding a valid refresh token.
      const { issuer, sessionRepository, refresh } = build({ activeAdminIds: new Set() });
      const token = await openSession(issuer);

      await expect(refresh.execute({ refreshToken: token })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );

      const [session] = sessionRepository.sessions;
      expect(session.isRevoked()).toBe(true);
      expect(session.toProps().revokedReason).toBe(PlatformAdminSessionRevokeReason.Admin);
    });

    it('refuses to refresh a session that has already been revoked by logout', async () => {
      const { issuer, refresh, logout } = build();
      const token = await openSession(issuer);

      await logout.execute({ refreshToken: token, actorId: adminUserId });

      await expect(refresh.execute({ refreshToken: token })).rejects.toBeInstanceOf(
        InvalidPlatformAdminRefreshTokenException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the session and records an audit entry', async () => {
      const { issuer, sessionRepository, auditLogWriter, logout } = build();
      const token = await openSession(issuer);

      await logout.execute({ refreshToken: token, actorId: adminUserId });

      const [session] = sessionRepository.sessions;
      expect(session.isRevoked()).toBe(true);
      expect(session.toProps().revokedReason).toBe(PlatformAdminSessionRevokeReason.Logout);
      expect(session.toProps().revokedAt).toEqual(now);
      expect(auditLogWriter.entries.some((entry) => entry.action === 'platform_admin.logout')).toBe(
        true,
      );
    });

    it('is idempotent - logging out twice neither throws nor rewrites the revocation', async () => {
      const { issuer, sessionRepository, auditLogWriter, logout } = build();
      const token = await openSession(issuer);

      await logout.execute({ refreshToken: token, actorId: adminUserId });
      await expect(
        logout.execute({ refreshToken: token, actorId: adminUserId }),
      ).resolves.toBeUndefined();

      expect(
        auditLogWriter.entries.filter((entry) => entry.action === 'platform_admin.logout'),
      ).toHaveLength(1);
      expect(sessionRepository.sessions[0].toProps().revokedReason).toBe(
        PlatformAdminSessionRevokeReason.Logout,
      );
    });

    it('will not let one admin revoke another admin session', async () => {
      const { issuer, sessionRepository, logout } = build();
      const victimToken = await openSession(issuer, otherAdminUserId);

      // Silently ignored rather than rejected - an error here would let a
      // caller probe which tokens exist.
      await expect(
        logout.execute({ refreshToken: victimToken, actorId: adminUserId }),
      ).resolves.toBeUndefined();

      expect(sessionRepository.sessions[0].isRevoked()).toBe(false);
    });

    it('ignores an unknown token', async () => {
      const { logout } = build();

      await expect(
        logout.execute({ refreshToken: 'not-a-real-token', actorId: adminUserId }),
      ).resolves.toBeUndefined();
    });
  });
});
