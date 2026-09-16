import { PlatformAdminSession } from '../entities/platform-admin-session.entity';
import { PlatformAdminSessionRevokeReason } from '../enums/platform-admin.enums';

/**
 * The only way `platform_admin_sessions` is ever read or written. Kept
 * deliberately separate from `DeviceSessionRepository` — the two pipelines
 * must not share a persistence boundary (AUTHENTICATION_ARCHITECTURE.md
 * §5.2), and a single repository over both tables would make it possible to
 * hand a tenant refresh token to the Platform Admin refresh path by mistake.
 *
 * `rotateIfHashMatches` exists for the same reason
 * `DeviceSessionRepository.rotateRefreshTokenIfHashMatches` does: rotation
 * must be a single conditional UPDATE, not read-then-write. Two concurrent
 * refreshes presenting the same token would otherwise both observe an active
 * session and both mint a token, leaving one live refresh token permanently
 * orphaned from the row that tracks it.
 */
export interface PlatformAdminSessionRepository {
  findByRefreshTokenHash(hash: string): Promise<PlatformAdminSession | null>;

  /**
   * Replay lookup: a token that has already been rotated away still matches
   * here, which is what makes reuse detectable.
   */
  findByPreviousRefreshTokenHash(hash: string): Promise<PlatformAdminSession | null>;

  findById(id: string): Promise<PlatformAdminSession | null>;

  create(session: PlatformAdminSession): Promise<void>;

  /**
   * Atomic compare-and-swap on `refreshTokenHash`. Returns `hash_mismatch`
   * when the row no longer carries the presented hash (a concurrent refresh
   * won the race) or is no longer active — never throws for that case, since
   * it is an ordinary outcome the caller maps to an invalid-token response.
   */
  rotateIfHashMatches(input: {
    presentedHash: string;
    newHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<{ status: 'rotated'; sessionId: string } | { status: 'hash_mismatch' }>;

  revokeById(id: string, reason: PlatformAdminSessionRevokeReason, at: Date): Promise<void>;

  /**
   * Used by the reuse-detection path (revoke every live session of an admin
   * whose token was replayed) and by Deactivate Platform Admin, so a revoked
   * admin's console cannot keep refreshing until its session expires.
   */
  revokeAllByPlatformAdminUserId(
    platformAdminUserId: string,
    reason: PlatformAdminSessionRevokeReason,
    at: Date,
  ): Promise<void>;
}

export const PLATFORM_ADMIN_SESSION_REPOSITORY = Symbol('PLATFORM_ADMIN_SESSION_REPOSITORY');
