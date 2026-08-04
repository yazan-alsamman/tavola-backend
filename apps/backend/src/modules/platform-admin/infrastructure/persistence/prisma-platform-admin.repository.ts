import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

@Injectable()
export class PrismaPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findActiveAdminContext(userId: string): Promise<PlatformAdminAuthContext | null> {
    const row = await this.prismaContext.client.platformAdmin.findUnique({
      where: { userId },
    });
    if (!row || row.revokedAt !== null) {
      return null;
    }
    return { role: row.role as PlatformAdminRole };
  }

  async findById(id: string): Promise<PlatformAdminRecord | null> {
    const row = await this.prismaContext.client.platformAdmin.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByUserId(userId: string): Promise<PlatformAdminRecord | null> {
    const row = await this.prismaContext.client.platformAdmin.findUnique({ where: { userId } });
    return row ? this.toRecord(row) : null;
  }

  async list(page: number, limit: number): Promise<PlatformAdminListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.platformAdmin.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.platformAdmin.count(),
    ]);
    return { items: rows.map((row) => this.toRecord(row)), total };
  }

  async create(record: PlatformAdminRecord): Promise<void> {
    await this.prismaContext.client.platformAdmin.create({
      data: {
        id: record.id,
        userId: record.userId,
        role: record.role,
        createdAt: record.createdAt,
        revokedAt: record.revokedAt,
      },
    });
  }

  async updateRole(id: string, role: PlatformAdminRole, _at: Date): Promise<void> {
    await this.prismaContext.client.platformAdmin.update({
      where: { id },
      data: { role },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prismaContext.client.platformAdmin.update({
      where: { id },
      data: { revokedAt: at },
    });
  }

  async reactivate(id: string): Promise<void> {
    await this.prismaContext.client.platformAdmin.update({
      where: { id },
      data: { revokedAt: null },
    });
  }

  private toRecord(row: {
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    revokedAt: Date | null;
  }): PlatformAdminRecord {
    return {
      id: row.id,
      userId: row.userId,
      role: row.role as PlatformAdminRole,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
    };
  }
}
