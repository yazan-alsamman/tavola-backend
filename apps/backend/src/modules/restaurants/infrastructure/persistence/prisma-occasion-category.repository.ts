import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { OccasionCategory } from '../../domain/entities/occasion-category.entity';
import { OccasionCategoryRepository } from '../../domain/repositories/occasion-category.repository';
import { OccasionCategoryPrismaMapper } from './occasion-category.prisma-mapper';

/**
 * `OccasionCategory` is platform-managed reference data, not tenant-owned -
 * NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`. Queries here run
 * through the tenant-scoped `PrismaContext` client as a verified no-op
 * passthrough, exactly like `PrismaWorkingHoursRepository`.
 */
@Injectable()
export class PrismaOccasionCategoryRepository implements OccasionCategoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllActive(): Promise<OccasionCategory[]> {
    const rows = await this.prismaContext.client.occasionCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((row) => OccasionCategoryPrismaMapper.toDomain(row));
  }

  async findByIds(ids: string[]): Promise<OccasionCategory[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.occasionCategory.findMany({
      where: { id: { in: ids } },
    });
    return rows.map((row) => OccasionCategoryPrismaMapper.toDomain(row));
  }
}
