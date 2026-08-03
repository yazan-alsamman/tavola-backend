import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  MenuItemAddOnId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { MenuItemAddOn } from '../../domain/entities/menu-item-add-on.entity';
import { MenuItemAddOnRepository } from '../../domain/repositories/menu-item-add-on.repository';
import { MenuItemAddOnPrismaMapper } from './menu-item-add-on.prisma-mapper';

@Injectable()
export class PrismaMenuItemAddOnRepository implements MenuItemAddOnRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(addOn: MenuItemAddOn): Promise<void> {
    const data = MenuItemAddOnPrismaMapper.toPersistence(addOn);
    await this.prismaContext.client.menuItemAddOn.create({ data });
  }

  async findByIdAndRestaurantId(
    id: MenuItemAddOnId,
    restaurantId: RestaurantId,
  ): Promise<MenuItemAddOn | null> {
    const row = await this.prismaContext.client.menuItemAddOn.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? MenuItemAddOnPrismaMapper.toDomain(row) : null;
  }

  async findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemAddOn[]> {
    const rows = await this.prismaContext.client.menuItemAddOn.findMany({
      where: { menuItemId: menuItemId.value, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(MenuItemAddOnPrismaMapper.toDomain);
  }

  async update(addOn: MenuItemAddOn): Promise<void> {
    const data = MenuItemAddOnPrismaMapper.toPersistence(addOn);
    await this.prismaContext.client.menuItemAddOn.updateMany({
      where: { id: data.id },
      data: {
        name: data.name,
        price: data.price,
        active: data.active,
        updatedAt: data.updatedAt,
      },
    });
  }

  async softDelete(id: MenuItemAddOnId, at: Date): Promise<void> {
    await this.prismaContext.client.menuItemAddOn.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
