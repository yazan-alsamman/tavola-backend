import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { PlatformAdminSession } from '../../domain/entities/platform-admin-session.entity';
import { PlatformAdminSessionRevokeReason } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminSessionRepository } from '../../domain/repositories/platform-admin-session.repository';
import { toPlatformAdminSessionEntity } from './platform-admin-session.prisma-mapper';

/**
 * Injects `PrismaContext` (not the raw `PrismaService`) like every other
 * repository in this module: `platform_admin_sessions` is not a tenant-owned
 * model, so no organization scoping applies, but going through the context
 * keeps the single client/transaction-participation convention intact.
 */
@Injectable()
export class PrismaPlatformAdminSessionRepository implements PlatformAdminSessionRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByRefreshTokenHash(hash: string): Promise<PlatformAdminSession | null> {
    const row = await this.prismaContext.client.platformAdminSession.findUnique({
      where: { refreshTokenHash: hash },
    });
    return row ? toPlatformAdminSessionEntity(row) : null;
  }

  async findByPreviousRefreshTokenHash(hash: string): Promise<PlatformAdminSession | null> {
    const row = await this.prismaContext.client.platformAdminSession.findFirst({
      where: { previousRefreshTokenHash: hash },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? toPlatformAdminSessionEntity(row) : null;
  }

  async findById(id: string): Promise<PlatformAdminSession | null> {
    const row = await this.prismaContext.client.platformAdminSession.findUnique({ where: { id } });
    return row ? toPlatformAdminSessionEntity(row) : null;
  }

  async create(session: PlatformAdminSession): Promise<void> {
    const props = session.toProps();
    await this.prismaContext.client.platformAdminSession.create({
      data: {
        id: props.id,
        platformAdminUserId: props.platformAdminUserId,
        refreshTokenHash: props.refreshTokenHash,
        previousRefreshTokenHash: props.previousRefreshTokenHash,
        ipAddress: props.ipAddress,
        userAgent: props.userAgent,
        lastUsedAt: props.lastUsedAt,
        revokedAt: props.revokedAt,
        revokedReason: props.revokedReason,
        expiresAt: props.expiresAt,
        createdAt: props.createdAt,
      },
    });
  }

  /**
   * One conditional `updateMany` — the `where` clause re-asserts every
   * precondition (hash still current, not revoked, not expired) so the
   * database, not the application, arbitrates concurrent refreshes. A
   * second caller presenting the same token finds `count === 0` because the
   * winner already swapped the hash, and is reported as a mismatch.
   */
  async rotateIfHashMatches(input: {
    presentedHash: string;
    newHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<{ status: 'rotated'; sessionId: string } | { status: 'hash_mismatch' }> {
    const { count } = await this.prismaContext.client.platformAdminSession.updateMany({
      where: {
        refreshTokenHash: input.presentedHash,
        revokedAt: null,
        expiresAt: { gt: input.now },
      },
      data: {
        refreshTokenHash: input.newHash,
        previousRefreshTokenHash: input.presentedHash,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
      },
    });

    if (count === 0) {
      return { status: 'hash_mismatch' };
    }

    const rotated = await this.prismaContext.client.platformAdminSession.findUnique({
      where: { refreshTokenHash: input.newHash },
      select: { id: true },
    });

    // Unreachable in practice - the UPDATE above committed this exact hash.
    // Reported as a mismatch rather than asserted, so a lost row degrades to
    // "re-authenticate" instead of a 500.
    return rotated ? { status: 'rotated', sessionId: rotated.id } : { status: 'hash_mismatch' };
  }

  async revokeById(id: string, reason: PlatformAdminSessionRevokeReason, at: Date): Promise<void> {
    // `updateMany` + `revokedAt: null` rather than `update`: revocation is
    // write-once, so a session already revoked for another reason keeps its
    // original reason/timestamp, and revoking a row that no longer exists is
    // a no-op instead of a thrown P2025.
    await this.prismaContext.client.platformAdminSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
  }

  async revokeAllByPlatformAdminUserId(
    platformAdminUserId: string,
    reason: PlatformAdminSessionRevokeReason,
    at: Date,
  ): Promise<void> {
    await this.prismaContext.client.platformAdminSession.updateMany({
      where: { platformAdminUserId, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
  }
}
