import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { MenuCategoryId, MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { MenuCategory } from '../../domain/entities/menu-category.entity';
import { MenuCategoryRepository } from '../../domain/repositories/menu-category.repository';
import { MenuCategoryPrismaMapper } from './menu-category.prisma-mapper';

@Injectable()
export class PrismaMenuCategoryRepository implements MenuCategoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(category: MenuCategory): Promise<void> {
    const data = MenuCategoryPrismaMapper.toPersistence(category);
    await this.prismaContext.client.menuCategory.create({ data });
  }

  async findByIdAndRestaurantId(
    id: MenuCategoryId,
    restaurantId: RestaurantId,
  ): Promise<MenuCategory | null> {
    const row = await this.prismaContext.client.menuCategory.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? MenuCategoryPrismaMapper.toDomain(row) : null;
  }

  async findManyByMenuId(menuId: MenuId): Promise<MenuCategory[]> {
    const rows = await this.prismaContext.client.menuCategory.findMany({
      where: { menuId: menuId.value, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(MenuCategoryPrismaMapper.toDomain);
  }

  async update(category: MenuCategory): Promise<void> {
    const data = MenuCategoryPrismaMapper.toPersistence(category);
    await this.prismaContext.client.menuCategory.updateMany({
      where: { id: data.id },
      data: {
        name: data.name,
        description: data.description,
        displayOrder: data.displayOrder,
        imageFileId: data.imageFileId,
        updatedAt: data.updatedAt,
      },
    });
  }

  async reorder(orderedIds: MenuCategoryId[], at: Date): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        this.prismaContext.client.menuCategory.updateMany({
          where: { id: id.value },
          data: { displayOrder: index, updatedAt: at },
        }),
      ),
    );
  }

  async softDelete(id: MenuCategoryId, at: Date): Promise<void> {
    await this.prismaContext.client.menuCategory.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
