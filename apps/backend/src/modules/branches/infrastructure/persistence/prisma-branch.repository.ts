import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { Branch } from '../../domain/entities/branch.entity';
import { BranchListPage, BranchRepository } from '../../domain/repositories/branch.repository';
import { BranchPrismaMapper } from './branch.prisma-mapper';

/**
 * `Branch` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (no
 * direct `organizationId` column), so queries here run through the
 * tenant-scoped `PrismaContext` client as a verified no-op passthrough -
 * exactly like `PrismaWorkingHoursRepository`/`PrismaRestaurantSettingsRepository`.
 * This repository provides NO tenant isolation by itself. Every consuming use
 * case MUST resolve the parent `Restaurant` via `RestaurantRepository` (which
 * IS directly tenant-scoped) first, and only call these methods after that
 * succeeds - see `CreateBranchUseCase`/`GetBranchUseCase`/etc.
 */
@Injectable()
export class PrismaBranchRepository implements BranchRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByIdAndRestaurantId(id: BranchId, restaurantId: RestaurantId): Promise<Branch | null> {
    const row = await this.prismaContext.client.branch.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? BranchPrismaMapper.toDomain(row) : null;
  }

  async findById(id: BranchId): Promise<Branch | null> {
    const row = await this.prismaContext.client.branch.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? BranchPrismaMapper.toDomain(row) : null;
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<BranchListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.branch.findMany({
        where: { restaurantId: restaurantId.value, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.branch.count({
        where: { restaurantId: restaurantId.value, deletedAt: null },
      }),
    ]);

    return { items: rows.map(BranchPrismaMapper.toDomain), total };
  }

  async save(branch: Branch): Promise<void> {
    const data = BranchPrismaMapper.toPersistence(branch);
    await this.prismaContext.client.branch.upsert({
      where: { id: data.id },
      create: data,
      update: {
        city: data.city,
        district: data.district,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        countryCode: data.countryCode,
        currency: data.currency,
        timezone: data.timezone,
        phone: data.phone,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }
}
