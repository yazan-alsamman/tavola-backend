import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { BranchCoverImageRepository } from '../../domain/repositories/branch-cover-image.repository';

/**
 * `Branch` is transitively tenant-owned (no organizationId column), so these
 * queries are passthrough. Every caller resolves the parent Restaurant through
 * the tenant-scoped RestaurantRepository first.
 */
@Injectable()
export class PrismaBranchCoverImageRepository implements BranchCoverImageRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findCoverImageId(
    restaurantId: RestaurantId,
    branchId: string,
  ): Promise<string | null | undefined> {
    const row = await this.prismaContext.client.branch.findFirst({
      where: { id: branchId, restaurantId: restaurantId.value, deletedAt: null },
      select: { coverImageId: true },
    });
    return row === null ? undefined : row.coverImageId;
  }

  async assignCoverImage(branchId: string, fileId: string, at: Date): Promise<void> {
    await this.prismaContext.client.branch.update({
      where: { id: branchId },
      data: { coverImageId: fileId, updatedAt: at },
    });
  }

  async countCoverReferences(fileId: string): Promise<number> {
    const [restaurants, branches] = await Promise.all([
      this.prismaContext.client.restaurant.count({
        where: { OR: [{ coverImageId: fileId }, { logoId: fileId }] },
      }),
      this.prismaContext.client.branch.count({ where: { coverImageId: fileId } }),
    ]);
    return restaurants + branches;
  }
}
