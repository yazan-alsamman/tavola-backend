import { Entity } from '@shared/domain/base/entity.base';
import { PlatformAdminSessionRevokeReason } from '../enums/platform-admin.enums';
import { InvalidPlatformAdminSessionTransitionException } from '../exceptions/invalid-platform-admin-session-transition.exception';

export interface PlatformAdminSessionProps {
  id: string;
  platformAdminUserId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: PlatformAdminSessionRevokeReason | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * PlatformAdminSession aggregate — the Platform Owner console's refresh
 * session. Mirrors `DeviceSession`'s rotation and reuse-detection semantics
 * on the isolated Platform Admin pipeline (ADR-022's separate secret/issuer/
 * audience), never sharing its persistence or its repositories.
 *
 * Two differences from `DeviceSession`, both deliberate:
 *
 *  - No `TokenFamily`. `previousRefreshTokenHash` on the session row already
 *    carries the only signal reuse-detection needs — a presented hash that
 *    matches the *previous* value is a replay of an already-rotated token —
 *    and with no family there is nothing else to cascade-revoke beyond this
 *    one session, which `revoke()` handles directly.
 *  - No `sessionVersion`/`permissionsVersion`. `PlatformAdminGuard` re-reads
 *    the live `PlatformAdmin` row on every request, so a revocation or role
 *    demotion already takes effect immediately without a version counter to
 *    compare against.
 *
 * Every state method returns a new instance; the caller persists it. All
 * time-dependent predicates take `now` explicitly and never read the wall
 * clock, so behaviour is reproducible under a fixed clock in tests.
 */
export class PlatformAdminSession extends Entity<PlatformAdminSessionProps> {
  private constructor(props: PlatformAdminSessionProps) {
    super(props);
  }

  static create(props: {
    id: string;
    platformAdminUserId: string;
    refreshTokenHash: string;
    ipAddress: string | null;
    userAgent: string | null;
    expiresAt: Date;
    now: Date;
  }): PlatformAdminSession {
    if (props.expiresAt <= props.now) {
      throw new InvalidPlatformAdminSessionTransitionException(
        'A Platform Admin session cannot be created already expired.',
      );
    }
    return new PlatformAdminSession({
      id: props.id,
      platformAdminUserId: props.platformAdminUserId,
      refreshTokenHash: props.refreshTokenHash,
      previousRefreshTokenHash: null,
      ipAddress: props.ipAddress,
      userAgent: props.userAgent,
      lastUsedAt: null,
      revokedAt: null,
      revokedReason: null,
      expiresAt: props.expiresAt,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: PlatformAdminSessionProps): PlatformAdminSession {
    return new PlatformAdminSession({ ...props });
  }

  get sessionId(): string {
    return this.props.id;
  }

  get platformAdminUserId(): string {
    return this.props.platformAdminUserId;
  }

  get refreshTokenHash(): string {
    return this.props.refreshTokenHash;
  }

  get previousRefreshTokenHash(): string | null {
    return this.props.previousRefreshTokenHash;
  }

  get expiresAt(): Date {
    return new Date(this.props.expiresAt.getTime());
  }

  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt ? new Date(this.props.lastUsedAt.getTime()) : null;
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt <= now;
  }

  isActive(now: Date): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }

  /**
   * Rotation: the presented token becomes `previousRefreshTokenHash` so a
   * later replay of it is detectable, and the session's sliding expiry is
   * extended. Refuses to rotate a revoked or expired session rather than
   * silently resurrecting it.
   */
  rotate(params: { newRefreshTokenHash: string; expiresAt: Date; at: Date }): PlatformAdminSession {
    if (!this.isActive(params.at)) {
      throw new InvalidPlatformAdminSessionTransitionException(
        'Cannot rotate a revoked or expired Platform Admin session.',
      );
    }
    return PlatformAdminSession.reconstitute({
      ...this.props,
      previousRefreshTokenHash: this.props.refreshTokenHash,
      refreshTokenHash: params.newRefreshTokenHash,
      lastUsedAt: params.at,
      expiresAt: params.expiresAt,
      updatedAt: params.at,
    });
  }

  /**
   * Terminal and write-once — re-revoking an already-revoked session returns
   * the same instance rather than overwriting the original reason/timestamp,
   * so a `logout` arriving after a `reuse_detected` revoke cannot erase the
   * security-relevant record of why the session actually died. Callers use
   * reference equality to decide whether a persist/audit write is needed,
   * the same convention `Restaurant.suspend()` already established.
   */
  revoke(reason: PlatformAdminSessionRevokeReason, at: Date): PlatformAdminSession {
    if (this.isRevoked()) {
      return this;
    }
    return PlatformAdminSession.reconstitute({
      ...this.props,
      revokedAt: at,
      revokedReason: reason,
      updatedAt: at,
    });
  }

  toProps(): Readonly<PlatformAdminSessionProps> {
    return { ...this.props };
  }
}
