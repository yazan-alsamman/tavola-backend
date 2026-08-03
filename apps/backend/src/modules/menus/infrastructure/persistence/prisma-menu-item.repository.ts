import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  MenuItemId,
  MenuCategoryId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { MenuItem } from '../../domain/entities/menu-item.entity';
import { MenuItemRepository } from '../../domain/repositories/menu-item.repository';
import { MenuItemPrismaMapper } from './menu-item.prisma-mapper';

@Injectable()
export class PrismaMenuItemRepository implements MenuItemRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(item: MenuItem): Promise<void> {
    const data = MenuItemPrismaMapper.toPersistence(item);
    await this.prismaContext.client.menuItem.create({ data });
  }

  async findByIdAndRestaurantId(
    id: MenuItemId,
    restaurantId: RestaurantId,
  ): Promise<MenuItem | null> {
    const row = await this.prismaContext.client.menuItem.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? MenuItemPrismaMapper.toDomain(row) : null;
  }

  async findManyByCategoryId(categoryId: MenuCategoryId): Promise<MenuItem[]> {
    const rows = await this.prismaContext.client.menuItem.findMany({
      where: { categoryId: categoryId.value, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(MenuItemPrismaMapper.toDomain);
  }

  async update(item: MenuItem): Promise<void> {
    const data = MenuItemPrismaMapper.toPersistence(item);
    await this.prismaContext.client.menuItem.updateMany({
      where: { id: data.id },
      data: {
        name: data.name,
        description: data.description,
        price: data.price,
        currency: data.currency,
        imageFileId: data.imageFileId,
        availabilityMode: data.availabilityMode,
        isFeatured: data.isFeatured,
        preparationTimeMinutes: data.preparationTimeMinutes,
        spicyLevel: data.spicyLevel,
        calories: data.calories,
        allergens: data.allergens,
        dietaryLabels: data.dietaryLabels,
        displayOrder: data.displayOrder,
        updatedAt: data.updatedAt,
      },
    });
  }

  async reorder(orderedIds: MenuItemId[], at: Date): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        this.prismaContext.client.menuItem.updateMany({
          where: { id: id.value },
          data: { displayOrder: index, updatedAt: at },
        }),
      ),
    );
  }

  async softDelete(id: MenuItemId, at: Date): Promise<void> {
    await this.prismaContext.client.menuItem.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
