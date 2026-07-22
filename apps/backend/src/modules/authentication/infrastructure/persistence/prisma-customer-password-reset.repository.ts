import { Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  CustomerPasswordResetRepository,
  CustomerPasswordResetTokenRecord,
} from '../../domain/repositories/authentication.repositories';

function toRecord(row: {
  id: string;
  userId: string;
  codeHash: string;
  codeExpiresAt: Date;
  incorrectAttemptCount: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomerPasswordResetTokenRecord {
  return { ...row };
}

@Injectable()
export class PrismaCustomerPasswordResetRepository implements CustomerPasswordResetRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findActiveByUserId(
    userId: UserId,
    now: Date,
  ): Promise<CustomerPasswordResetTokenRecord | null> {
    const row = await this.prismaContext.client.customerPasswordResetToken.findFirst({
      where: { userId: userId.value, consumedAt: null, codeExpiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  async save(record: CustomerPasswordResetTokenRecord): Promise<void> {
    await this.prismaContext.client.customerPasswordResetToken.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        userId: record.userId,
        codeHash: record.codeHash,
        codeExpiresAt: record.codeExpiresAt,
        incorrectAttemptCount: record.incorrectAttemptCount,
        verifiedAt: record.verifiedAt,
        consumedAt: record.consumedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
      update: {
        codeHash: record.codeHash,
        codeExpiresAt: record.codeExpiresAt,
        incorrectAttemptCount: record.incorrectAttemptCount,
        verifiedAt: record.verifiedAt,
        consumedAt: record.consumedAt,
        updatedAt: record.updatedAt,
      },
    });
  }

  async invalidateActiveByUserId(userId: UserId): Promise<void> {
    await this.prismaContext.client.customerPasswordResetToken.updateMany({
      where: { userId: userId.value, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  async incrementAttemptCount(id: string): Promise<void> {
    await this.prismaContext.client.customerPasswordResetToken.update({
      where: { id },
      data: { incorrectAttemptCount: { increment: 1 } },
    });
  }

  async markVerified(id: string, at: Date): Promise<void> {
    await this.prismaContext.client.customerPasswordResetToken.update({
      where: { id },
      data: { verifiedAt: at, updatedAt: at },
    });
  }

  async consumeIfVerifiedAndUnconsumed(
    id: string,
    at: Date,
  ): Promise<CustomerPasswordResetTokenRecord | null> {
    const result = await this.prismaContext.client.customerPasswordResetToken.updateMany({
      where: { id, consumedAt: null, verifiedAt: { not: null } },
      data: { consumedAt: at, updatedAt: at },
    });
    if (result.count !== 1) {
      return null;
    }
    const row = await this.prismaContext.client.customerPasswordResetToken.findUnique({
      where: { id },
    });
    return row ? toRecord(row) : null;
  }
}
