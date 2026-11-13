import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchCategoryEntry,
  BranchCategoryKind,
  BranchCategoryRepository,
} from '../../domain/repositories/branch-category.repository';

/**
 * `BranchCuisineCategory`/`BranchOccasionCategory` carry no organizationId,
 * so these queries are passthrough. Every caller resolves the restaurant and
 * branch through the tenant-scoped repositories first.
 */
@Injectable()
export class PrismaBranchCategoryRepository implements BranchCategoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findCategoryIds(branchId: BranchId, kind: BranchCategoryKind): Promise<string[]> {
    const client = this.prismaContext.client;
    if (kind === 'cuisine') {
      const rows = await client.branchCuisineCategory.findMany({
        where: { branchId: branchId.value },
        select: { cuisineCategoryId: true },
      });
      return rows.map((row) => row.cuisineCategoryId);
    }
    const rows = await client.branchOccasionCategory.findMany({
      where: { branchId: branchId.value },
      select: { occasionCategoryId: true },
    });
    return rows.map((row) => row.occasionCategoryId);
  }

  async replaceCategoryIds(
    branchId: BranchId,
    kind: BranchCategoryKind,
    entries: BranchCategoryEntry[],
    at: Date,
  ): Promise<void> {
    await this.prismaContext.runInTransaction(async () => {
      const client = this.prismaContext.client;
      if (kind === 'cuisine') {
        await client.branchCuisineCategory.deleteMany({ where: { branchId: branchId.value } });
        if (entries.length > 0) {
          await client.branchCuisineCategory.createMany({
            data: entries.map((entry) => ({
              id: entry.id,
              branchId: branchId.value,
              cuisineCategoryId: entry.categoryId,
              createdAt: at,
              updatedAt: at,
            })),
          });
        }
        return;
      }
      await client.branchOccasionCategory.deleteMany({ where: { branchId: branchId.value } });
      if (entries.length > 0) {
        await client.branchOccasionCategory.createMany({
          data: entries.map((entry) => ({
            id: entry.id,
            branchId: branchId.value,
            occasionCategoryId: entry.categoryId,
            createdAt: at,
            updatedAt: at,
          })),
        });
      }
    });
  }

  async findCategoryIdsOfLiveBranches(
    restaurantId: RestaurantId,
    kind: BranchCategoryKind,
  ): Promise<string[]> {
    const client = this.prismaContext.client;
    const branchFilter = { restaurantId: restaurantId.value, deletedAt: null };
    if (kind === 'cuisine') {
      const rows = await client.branchCuisineCategory.findMany({
        where: { branch: branchFilter },
        distinct: ['cuisineCategoryId'],
        select: { cuisineCategoryId: true },
      });
      return rows.map((row) => row.cuisineCategoryId);
    }
    const rows = await client.branchOccasionCategory.findMany({
      where: { branch: branchFilter },
      distinct: ['occasionCategoryId'],
      select: { occasionCategoryId: true },
    });
    return rows.map((row) => row.occasionCategoryId);
  }
}
