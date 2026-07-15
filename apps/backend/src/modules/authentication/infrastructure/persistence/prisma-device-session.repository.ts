import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RefreshTokenHash } from '@shared/domain/value-objects/refresh-token-hash.vo';
import { SessionId, TokenFamilyId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import {
  DeviceSessionRepository,
  RotateRefreshTokenOutcome,
  RevokeSessionOutcome,
} from '../../domain/repositories/authentication.repositories';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { DeviceSessionPrismaMapper } from './device-session.prisma-mapper';

@Injectable()
export class PrismaDeviceSessionRepository implements DeviceSessionRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: SessionId): Promise<DeviceSession | null> {
    const row = await this.prismaContext.client.deviceSession.findUnique({
      where: { id: id.value },
    });
    return row ? DeviceSessionPrismaMapper.toDomain(row) : null;
  }

  async findByRefreshTokenHash(hash: RefreshTokenHash): Promise<DeviceSession | null> {
    const row = await this.prismaContext.client.deviceSession.findUnique({
      where: { refreshTokenHash: hash.value },
    });
    return row ? DeviceSessionPrismaMapper.toDomain(row) : null;
  }

  async findByPreviousRefreshTokenHash(hash: RefreshTokenHash): Promise<DeviceSession | null> {
    const row = await this.prismaContext.client.deviceSession.findFirst({
      where: { previousRefreshTokenHash: hash.value },
      orderBy: { lastUsedAt: 'desc' },
    });
    return row ? DeviceSessionPrismaMapper.toDomain(row) : null;
  }

  async countActiveByUserId(userId: UserId, now: Date): Promise<number> {
    return this.prismaContext.client.deviceSession.count({
      where: {
        userId: userId.value,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  async findActiveByUserId(userId: UserId, now: Date): Promise<DeviceSession[]> {
    const rows = await this.prismaContext.client.deviceSession.findMany({
      where: {
        userId: userId.value,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastUsedAt: 'asc' },
    });
    return rows.map((row) => DeviceSessionPrismaMapper.toDomain(row));
  }

  async save(session: DeviceSession): Promise<void> {
    const data = DeviceSessionPrismaMapper.toPersistence(session);
    await this.prismaContext.client.deviceSession.upsert({
      where: { id: data.id },
      create: data,
      update: {
        refreshTokenHash: data.refreshTokenHash,
        previousRefreshTokenHash: data.previousRefreshTokenHash,
        deviceName: data.deviceName,
        deviceType: data.deviceType,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        sessionVersion: data.sessionVersion,
        permissionsVersion: data.permissionsVersion,
        lastUsedAt: data.lastUsedAt,
        revokedAt: data.revokedAt,
        revokedReason: data.revokedReason,
        expiresAt: data.expiresAt,
      },
    });
  }

  async rotateRefreshTokenIfHashMatches(input: {
    presentedHash: string;
    newHash: string;
    now: Date;
    expiresAt: Date;
    permissionsVersion: number;
  }): Promise<RotateRefreshTokenOutcome> {
    const result = await this.prismaContext.client.deviceSession.updateMany({
      where: {
        refreshTokenHash: input.presentedHash,
        revokedAt: null,
        expiresAt: { gt: input.now },
      },
      data: {
        previousRefreshTokenHash: input.presentedHash,
        refreshTokenHash: input.newHash,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        permissionsVersion: input.permissionsVersion,
      },
    });

    if (result.count === 1) {
      const row = await this.prismaContext.client.deviceSession.findUnique({
        where: { refreshTokenHash: input.newHash },
      });
      return { status: 'rotated', sessionId: row?.id ?? '' };
    }

    return { status: 'hash_mismatch' };
  }

  async revokeAllByUserId(userId: UserId, at: Date, reason: string): Promise<void> {
    await this.prismaContext.client.deviceSession.updateMany({
      where: {
        userId: userId.value,
        revokedAt: null,
      },
      data: {
        revokedAt: at,
        revokedReason: reason as never,
      },
    });
  }

  async revokeAllByUserIdExceptSession(input: {
    userId: UserId;
    exceptSessionId: SessionId;
    at: Date;
    reason: SessionRevokeReason;
  }): Promise<string[]> {
    const rows = await this.prismaContext.client.deviceSession.findMany({
      where: {
        userId: input.userId.value,
        revokedAt: null,
        id: { not: input.exceptSessionId.value },
      },
      select: { id: true },
    });

    if (rows.length === 0) {
      return [];
    }

    await this.prismaContext.client.deviceSession.updateMany({
      where: {
        userId: input.userId.value,
        revokedAt: null,
        id: { not: input.exceptSessionId.value },
      },
      data: {
        revokedAt: input.at,
        revokedReason: input.reason as never,
      },
    });

    return rows.map((row) => row.id);
  }

  async updateSessionVersionIfActive(input: {
    sessionId: SessionId;
    userId: UserId;
    sessionVersion: number;
    at: Date;
  }): Promise<boolean> {
    const result = await this.prismaContext.client.deviceSession.updateMany({
      where: {
        id: input.sessionId.value,
        userId: input.userId.value,
        revokedAt: null,
      },
      data: {
        sessionVersion: input.sessionVersion,
        lastUsedAt: input.at,
      },
    });
    return result.count === 1;
  }

  async revokeAllByTokenFamilyId(
    tokenFamilyId: TokenFamilyId,
    at: Date,
    reason: SessionRevokeReason,
  ): Promise<void> {
    await this.prismaContext.client.deviceSession.updateMany({
      where: {
        tokenFamilyId: tokenFamilyId.value,
        revokedAt: null,
      },
      data: {
        revokedAt: at,
        revokedReason: reason as never,
      },
    });
  }

  async revokeByIdIfOwnedByUser(input: {
    sessionId: SessionId;
    userId: UserId;
    at: Date;
    reason: SessionRevokeReason;
  }): Promise<RevokeSessionOutcome> {
    const result = await this.prismaContext.client.deviceSession.updateMany({
      where: {
        id: input.sessionId.value,
        userId: input.userId.value,
        revokedAt: null,
      },
      data: {
        revokedAt: input.at,
        revokedReason: input.reason as never,
      },
    });

    if (result.count === 1) {
      return { status: 'revoked' };
    }

    const existing = await this.prismaContext.client.deviceSession.findFirst({
      where: {
        id: input.sessionId.value,
        userId: input.userId.value,
      },
    });

    if (!existing) {
      return { status: 'not_found_or_not_owned' };
    }

    if (existing.revokedAt !== null) {
      return { status: 'already_revoked' };
    }

    return { status: 'not_found_or_not_owned' };
  }
}
