import { PlatformAdminSession } from '@modules/platform-admin/domain/entities/platform-admin-session.entity';
import { PlatformAdminSessionRevokeReason } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { PlatformAdminSessionRepository } from '@modules/platform-admin/domain/repositories/platform-admin-session.repository';

/**
 * Test double for `PlatformAdminSessionRepository`, mirroring
 * `InMemoryDeviceSessionRepository`'s shape and conventions (public
 * `sessions` array for assertions, same replace-in-place `save` semantics).
 *
 * `rotateIfHashMatches` reproduces the production conditional-UPDATE
 * semantics rather than a naive read-then-write, so a spec that exercises
 * the concurrent-refresh path observes the same `hash_mismatch` outcome the
 * database would produce.
 */
export class InMemoryPlatformAdminSessionRepository implements PlatformAdminSessionRepository {
  readonly sessions: PlatformAdminSession[] = [];

  async findByRefreshTokenHash(hash: string): Promise<PlatformAdminSession | null> {
    return this.sessions.find((session) => session.refreshTokenHash === hash) ?? null;
  }

  async findByPreviousRefreshTokenHash(hash: string): Promise<PlatformAdminSession | null> {
    return this.sessions.find((session) => session.previousRefreshTokenHash === hash) ?? null;
  }

  async findById(id: string): Promise<PlatformAdminSession | null> {
    return this.sessions.find((session) => session.sessionId === id) ?? null;
  }

  async create(session: PlatformAdminSession): Promise<void> {
    this.sessions.push(session);
  }

  async rotateIfHashMatches(input: {
    presentedHash: string;
    newHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<{ status: 'rotated'; sessionId: string } | { status: 'hash_mismatch' }> {
    const index = this.sessions.findIndex(
      (session) => session.refreshTokenHash === input.presentedHash && session.isActive(input.now),
    );
    if (index < 0) {
      return { status: 'hash_mismatch' };
    }

    const rotated = this.sessions[index].rotate({
      newRefreshTokenHash: input.newHash,
      expiresAt: input.expiresAt,
      at: input.now,
    });
    this.sessions[index] = rotated;
    return { status: 'rotated', sessionId: rotated.sessionId };
  }

  async revokeById(id: string, reason: PlatformAdminSessionRevokeReason, at: Date): Promise<void> {
    const index = this.sessions.findIndex((session) => session.sessionId === id);
    if (index >= 0) {
      this.sessions[index] = this.sessions[index].revoke(reason, at);
    }
  }

  async revokeAllByPlatformAdminUserId(
    platformAdminUserId: string,
    reason: PlatformAdminSessionRevokeReason,
    at: Date,
  ): Promise<void> {
    for (let index = 0; index < this.sessions.length; index += 1) {
      if (this.sessions[index].platformAdminUserId === platformAdminUserId) {
        this.sessions[index] = this.sessions[index].revoke(reason, at);
      }
    }
  }
}
