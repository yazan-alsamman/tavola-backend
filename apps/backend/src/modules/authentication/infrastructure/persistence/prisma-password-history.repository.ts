import { Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  PasswordHistoryRecord,
  PasswordHistoryRepository,
} from '../../domain/repositories/authentication.repositories';

@Injectable()
export class PrismaPasswordHistoryRepository implements PasswordHistoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findRecentByUserId(userId: UserId, limit: number): Promise<PasswordHistoryRecord[]> {
    const rows = await this.prismaContext.client.passwordHistory.findMany({
      where: { userId: userId.value },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
    }));
  }

  async save(record: PasswordHistoryRecord): Promise<void> {
    await this.prismaContext.client.passwordHistory.create({
      data: {
        id: record.id,
        userId: record.userId,
        passwordHash: record.passwordHash,
        createdAt: record.createdAt,
      },
    });
  }

  async pruneBeyondLimit(userId: UserId, keep: number): Promise<void> {
    const rows = await this.prismaContext.client.passwordHistory.findMany({
      where: { userId: userId.value },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const idsToDelete = rows.slice(keep).map((row) => row.id);
    if (idsToDelete.length === 0) {
      return;
    }

    await this.prismaContext.client.passwordHistory.deleteMany({
      where: { id: { in: idsToDelete } },
    });
  }
}
