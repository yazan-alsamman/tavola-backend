import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { CuisineCategory } from '../../domain/entities/cuisine-category.entity';
import { CuisineCategoryRepository } from '../../domain/repositories/cuisine-category.repository';
import { CuisineCategoryPrismaMapper } from './cuisine-category.prisma-mapper';

/**
 * `CuisineCategory` is platform-managed reference data, not tenant-owned -
 * NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`. Queries here run
 * through the tenant-scoped `PrismaContext` client as a verified no-op
 * passthrough, exactly like `PrismaWorkingHoursRepository`.
 */
@Injectable()
export class PrismaCuisineCategoryRepository implements CuisineCategoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllActive(): Promise<CuisineCategory[]> {
    const rows = await this.prismaContext.client.cuisineCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((row) => CuisineCategoryPrismaMapper.toDomain(row));
  }

  async findByIds(ids: string[]): Promise<CuisineCategory[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.cuisineCategory.findMany({
      where: { id: { in: ids } },
    });
    return rows.map((row) => CuisineCategoryPrismaMapper.toDomain(row));
  }
}
