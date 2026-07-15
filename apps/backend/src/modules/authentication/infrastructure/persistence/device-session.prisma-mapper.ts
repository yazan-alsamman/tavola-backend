import {
  DeviceSession as PrismaDeviceSession,
  DeviceType as PrismaDeviceType,
  SessionRevokeReason as PrismaSessionRevokeReason,
} from '@prisma/client';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { DeviceType, SessionRevokeReason } from '../../domain/enums/authentication.enums';

export class DeviceSessionPrismaMapper {
  static toDomain(row: PrismaDeviceSession): DeviceSession {
    return DeviceSession.reconstitute({
      id: row.id,
      userId: row.userId,
      tokenFamilyId: row.tokenFamilyId,
      refreshTokenHash: row.refreshTokenHash,
      previousRefreshTokenHash: row.previousRefreshTokenHash,
      deviceName: row.deviceName,
      deviceType: row.deviceType as DeviceType,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      sessionVersion: row.sessionVersion,
      permissionsVersion: row.permissionsVersion,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason as SessionRevokeReason | null,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    });
  }

  static toPersistence(session: DeviceSession): PrismaDeviceSession {
    const props = session.toProps();
    return {
      id: props.id,
      userId: props.userId,
      tokenFamilyId: props.tokenFamilyId,
      refreshTokenHash: props.refreshTokenHash,
      previousRefreshTokenHash: props.previousRefreshTokenHash,
      deviceName: props.deviceName,
      deviceType: props.deviceType as PrismaDeviceType,
      ipAddress: props.ipAddress,
      userAgent: props.userAgent,
      sessionVersion: props.sessionVersion,
      permissionsVersion: props.permissionsVersion,
      lastUsedAt: props.lastUsedAt,
      revokedAt: props.revokedAt,
      revokedReason: props.revokedReason as PrismaSessionRevokeReason | null,
      expiresAt: props.expiresAt,
      createdAt: props.createdAt,
    };
  }
}
