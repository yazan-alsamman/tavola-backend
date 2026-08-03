import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  MenuItemOptionGroupId,
  MenuItemId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { MenuItemOptionGroup } from '../../domain/entities/menu-item-option-group.entity';
import { MenuItemOptionGroupRepository } from '../../domain/repositories/menu-item-option-group.repository';
import { MenuItemOptionGroupPrismaMapper } from './menu-item-option-group.prisma-mapper';

@Injectable()
export class PrismaMenuItemOptionGroupRepository implements MenuItemOptionGroupRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(group: MenuItemOptionGroup): Promise<void> {
    const data = MenuItemOptionGroupPrismaMapper.toPersistence(group);
    await this.prismaContext.client.menuItemOptionGroup.create({ data });
  }

  async findByIdAndRestaurantId(
    id: MenuItemOptionGroupId,
    restaurantId: RestaurantId,
  ): Promise<MenuItemOptionGroup | null> {
    const row = await this.prismaContext.client.menuItemOptionGroup.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? MenuItemOptionGroupPrismaMapper.toDomain(row) : null;
  }

  async findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemOptionGroup[]> {
    const rows = await this.prismaContext.client.menuItemOptionGroup.findMany({
      where: { menuItemId: menuItemId.value, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(MenuItemOptionGroupPrismaMapper.toDomain);
  }

  async update(group: MenuItemOptionGroup): Promise<void> {
    const data = MenuItemOptionGroupPrismaMapper.toPersistence(group);
    await this.prismaContext.client.menuItemOptionGroup.updateMany({
      where: { id: data.id },
      data: {
        name: data.name,
        required: data.required,
        minSelections: data.minSelections,
        maxSelections: data.maxSelections,
        updatedAt: data.updatedAt,
      },
    });
  }

  async softDelete(id: MenuItemOptionGroupId, at: Date): Promise<void> {
    await this.prismaContext.client.menuItemOptionGroup.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
