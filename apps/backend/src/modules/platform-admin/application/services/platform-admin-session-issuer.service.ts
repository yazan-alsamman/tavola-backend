import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminAuthConfig } from '@config/platform-admin-auth.config';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { OpaqueTokenService } from '@modules/authentication/domain/services/opaque-token.port';
import { OPAQUE_TOKEN_SERVICE } from '@modules/authentication/domain/tokens/authentication.tokens';
import { PlatformAdminSession } from '../../domain/entities/platform-admin-session.entity';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import {
  PlatformAdminSessionRepository,
  PLATFORM_ADMIN_SESSION_REPOSITORY,
} from '../../domain/repositories/platform-admin-session.repository';
import {
  PlatformAdminTokenService,
  PLATFORM_ADMIN_TOKEN_SERVICE,
} from '../../domain/services/platform-admin-token.port';

export interface IssuedPlatformAdminSession {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date;
}

/**
 * The single place a Platform Admin access/refresh token pair is minted.
 * Login (first issue) and Refresh (rotation) share identical token shape,
 * TTL arithmetic and hashing; without this service that logic would be
 * duplicated across two use cases and could drift — which is exactly how a
 * refresh token ends up outliving its session, or an access token ends up
 * signed with claims the guard does not expect.
 *
 * Refresh tokens are opaque and stored only as SHA-256 digests
 * (`OpaqueTokenService`, reused verbatim from the tenant pipeline — the
 * hashing primitive is shared, the token pipeline is not). The plaintext is
 * returned to the caller once, at issue time, and is never recoverable from
 * the database afterwards.
 */
@Injectable()
export class PlatformAdminSessionIssuer {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(
    configService: ConfigService,
    @Inject(PLATFORM_ADMIN_TOKEN_SERVICE)
    private readonly tokenService: PlatformAdminTokenService,
    @Inject(PLATFORM_ADMIN_SESSION_REPOSITORY)
    private readonly sessionRepository: PlatformAdminSessionRepository,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {
    const config = configService.get<PlatformAdminAuthConfig>('platformAdminAuth', {
      infer: true,
    });
    this.accessTokenTtlSeconds = config?.jwtExpirySeconds ?? 900;
    this.refreshTtlDays = config?.refreshExpiryDays ?? 7;
  }

  /** First issue — creates the session row. Used by login only. */
  async issueForNewSession(params: {
    platformAdminUserId: string;
    role: PlatformAdminRole;
    ipAddress: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<IssuedPlatformAdminSession> {
    const refreshToken = this.opaqueTokenService.generate();
    const refreshTokenExpiresAt = this.refreshExpiryFrom(params.now);

    const session = PlatformAdminSession.create({
      id: this.idGenerator.generate(),
      platformAdminUserId: params.platformAdminUserId,
      refreshTokenHash: this.opaqueTokenService.hash(refreshToken),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt: refreshTokenExpiresAt,
      now: params.now,
    });

    await this.sessionRepository.create(session);

    return {
      sessionId: session.sessionId,
      refreshToken,
      refreshTokenExpiresAt,
      ...this.signAccessToken(params.platformAdminUserId, params.role, params.now),
    };
  }

  /**
   * Rotation — the session row already exists and was swapped atomically by
   * the caller, so this only signs the new access token and echoes the
   * already-generated refresh token back.
   */
  signAccessToken(
    platformAdminUserId: string,
    role: PlatformAdminRole,
    now: Date,
  ): { accessToken: string; accessTokenExpiresAt: Date } {
    return {
      accessToken: this.tokenService.signAccessToken({ sub: platformAdminUserId, role }),
      accessTokenExpiresAt: new Date(now.getTime() + this.accessTokenTtlSeconds * 1000),
    };
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = this.opaqueTokenService.generate();
    return { token, hash: this.opaqueTokenService.hash(token) };
  }

  hashRefreshToken(token: string): string {
    return this.opaqueTokenService.hash(token);
  }

  refreshExpiryFrom(now: Date): Date {
    return new Date(now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}
