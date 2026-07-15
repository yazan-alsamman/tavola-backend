import { Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  PasswordResetRepository,
  PasswordResetTokenRecord,
} from '../../domain/repositories/authentication.repositories';

@Injectable()
export class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    const row = await this.prismaContext.client.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
    };
  }

  async save(record: PasswordResetTokenRecord): Promise<void> {
    await this.prismaContext.client.passwordResetToken.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        userId: record.userId,
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
        createdAt: record.createdAt,
      },
      update: {
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
      },
    });
  }

  async invalidateActiveByUserId(userId: UserId): Promise<void> {
    await this.prismaContext.client.passwordResetToken.updateMany({
      where: { userId: userId.value, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  async consumeIfActive(id: string, consumedAt: Date): Promise<boolean> {
    const result = await this.prismaContext.client.passwordResetToken.updateMany({
      where: {
        id,
        consumedAt: null,
        expiresAt: { gt: consumedAt },
      },
      data: { consumedAt },
    });
    return result.count === 1;
  }
}
