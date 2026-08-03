import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { Menu } from '../../domain/entities/menu.entity';
import { MenuRepository } from '../../domain/repositories/menu.repository';
import { MenuPrismaMapper } from './menu.prisma-mapper';

/**
 * `Menu` is not in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` - the
 * ordinary tenant-scoped `PrismaContext` client is a safe no-op passthrough
 * here, exactly like `PrismaOfferRepository`/`PrismaReviewRepository`.
 */
@Injectable()
export class PrismaMenuRepository implements MenuRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(menu: Menu): Promise<void> {
    const data = MenuPrismaMapper.toPersistence(menu);
    await this.prismaContext.client.menu.create({ data });
  }

  async findByIdAndRestaurantId(id: MenuId, restaurantId: RestaurantId): Promise<Menu | null> {
    const row = await this.prismaContext.client.menu.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? MenuPrismaMapper.toDomain(row) : null;
  }

  async findManyByRestaurantId(restaurantId: RestaurantId): Promise<Menu[]> {
    const rows = await this.prismaContext.client.menu.findMany({
      where: { restaurantId: restaurantId.value, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(MenuPrismaMapper.toDomain);
  }

  async findDefaultByRestaurantId(restaurantId: RestaurantId): Promise<Menu | null> {
    const row = await this.prismaContext.client.menu.findFirst({
      where: { restaurantId: restaurantId.value, isDefault: true, active: true, deletedAt: null },
    });
    return row ? MenuPrismaMapper.toDomain(row) : null;
  }

  async existsAnyForRestaurant(restaurantId: RestaurantId): Promise<boolean> {
    const count = await this.prismaContext.client.menu.count({
      where: { restaurantId: restaurantId.value, deletedAt: null },
    });
    return count > 0;
  }

  async update(menu: Menu): Promise<void> {
    const data = MenuPrismaMapper.toPersistence(menu);
    await this.prismaContext.client.menu.updateMany({
      where: { id: data.id },
      data: {
        name: data.name,
        active: data.active,
        isDefault: data.isDefault,
        displayOrder: data.displayOrder,
        updatedAt: data.updatedAt,
      },
    });
  }

  async setAsDefault(menuId: MenuId, restaurantId: RestaurantId, at: Date): Promise<void> {
    // Both writes run inside the same UnitOfWorkPort transaction as the
    // caller (SetDefaultMenuUseCase) - PrismaContext binds the transactional
    // client via AsyncLocalStorage for the whole unitOfWork.execute() call,
    // so no explicit $transaction here is needed or correct (nesting would
    // require the unextended TransactionClient type, which loses tenant
    // scoping - see PrismaContext's own doc comment).
    await this.prismaContext.client.menu.updateMany({
      where: { restaurantId: restaurantId.value, isDefault: true, deletedAt: null },
      data: { isDefault: false, updatedAt: at },
    });
    await this.prismaContext.client.menu.updateMany({
      where: { id: menuId.value, restaurantId: restaurantId.value, deletedAt: null },
      data: { isDefault: true, updatedAt: at },
    });
  }

  async softDelete(id: MenuId, at: Date): Promise<void> {
    await this.prismaContext.client.menu.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }

  async findRestaurantIdsWithActiveDefaultMenu(
    restaurantIds: RestaurantId[],
  ): Promise<Set<string>> {
    if (restaurantIds.length === 0) {
      return new Set();
    }
    const rows = await this.prismaContext.client.menu.findMany({
      where: {
        restaurantId: { in: restaurantIds.map((id) => id.value) },
        isDefault: true,
        active: true,
        deletedAt: null,
      },
      select: { restaurantId: true },
      distinct: ['restaurantId'],
    });
    return new Set(rows.map((row) => row.restaurantId));
  }
}
