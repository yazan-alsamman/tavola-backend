import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  MenuItemOptionId,
  MenuItemOptionGroupId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { MenuItemOption } from '../../domain/entities/menu-item-option.entity';
import { MenuItemOptionRepository } from '../../domain/repositories/menu-item-option.repository';
import { MenuItemOptionPrismaMapper } from './menu-item-option.prisma-mapper';

@Injectable()
export class PrismaMenuItemOptionRepository implements MenuItemOptionRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(option: MenuItemOption): Promise<void> {
    const data = MenuItemOptionPrismaMapper.toPersistence(option);
    await this.prismaContext.client.menuItemOption.create({ data });
  }

  async findByIdAndRestaurantId(
    id: MenuItemOptionId,
    restaurantId: RestaurantId,
  ): Promise<MenuItemOption | null> {
    const row = await this.prismaContext.client.menuItemOption.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? MenuItemOptionPrismaMapper.toDomain(row) : null;
  }

  async findManyByOptionGroupId(optionGroupId: MenuItemOptionGroupId): Promise<MenuItemOption[]> {
    const rows = await this.prismaContext.client.menuItemOption.findMany({
      where: { optionGroupId: optionGroupId.value, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(MenuItemOptionPrismaMapper.toDomain);
  }

  async update(option: MenuItemOption): Promise<void> {
    const data = MenuItemOptionPrismaMapper.toPersistence(option);
    await this.prismaContext.client.menuItemOption.updateMany({
      where: { id: data.id },
      data: {
        name: data.name,
        priceModifier: data.priceModifier,
        active: data.active,
        updatedAt: data.updatedAt,
      },
    });
  }

  async softDelete(id: MenuItemOptionId, at: Date): Promise<void> {
    await this.prismaContext.client.menuItemOption.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
