import { PlatformAdminSession } from '../../domain/entities/platform-admin-session.entity';
import { PlatformAdminSessionRevokeReason } from '../../domain/enums/platform-admin.enums';

/** Prisma row shape, declared structurally so the mapper stays testable without the generated client. */
export interface PlatformAdminSessionRow {
  id: string;
  platformAdminUserId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence -> domain. Mirrors `device-session.prisma-mapper.ts`: a plain
 * function, not a class, and the only place the generated row shape is
 * translated into the aggregate.
 */
export function toPlatformAdminSessionEntity(row: PlatformAdminSessionRow): PlatformAdminSession {
  return PlatformAdminSession.reconstitute({
    id: row.id,
    platformAdminUserId: row.platformAdminUserId,
    refreshTokenHash: row.refreshTokenHash,
    previousRefreshTokenHash: row.previousRefreshTokenHash,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason as PlatformAdminSessionRevokeReason | null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
