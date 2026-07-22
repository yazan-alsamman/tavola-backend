import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { PlatformAdminRepository } from '../../domain/repositories/platform-admin.repository';

@Injectable()
export class PrismaPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async isActiveAdmin(userId: string): Promise<boolean> {
    const row = await this.prismaContext.client.platformAdmin.findUnique({
      where: { userId },
    });
    return row !== null && row.revokedAt === null;
  }
}
