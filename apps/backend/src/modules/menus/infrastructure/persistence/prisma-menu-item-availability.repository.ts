import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { MenuItemId } from '@shared/domain/value-objects/identifiers.vo';
import { MenuItemAvailability } from '../../domain/entities/menu-item-availability.entity';
import { MenuItemAvailabilityRepository } from '../../domain/repositories/menu-item-availability.repository';
import { MenuItemAvailabilityPrismaMapper } from './menu-item-availability.prisma-mapper';

@Injectable()
export class PrismaMenuItemAvailabilityRepository implements MenuItemAvailabilityRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findManyByMenuItemId(menuItemId: MenuItemId): Promise<MenuItemAvailability[]> {
    const rows = await this.prismaContext.client.menuItemAvailability.findMany({
      where: { menuItemId: menuItemId.value },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(MenuItemAvailabilityPrismaMapper.toDomain);
  }

  async replaceForMenuItem(menuItemId: MenuItemId, windows: MenuItemAvailability[]): Promise<void> {
    // Both statements run inside the caller's UnitOfWorkPort transaction
    // (same AsyncLocalStorage-bound client as PrismaMenuRepository.setAsDefault).
    await this.prismaContext.client.menuItemAvailability.deleteMany({
      where: { menuItemId: menuItemId.value },
    });
    if (windows.length === 0) {
      return;
    }
    await this.prismaContext.client.menuItemAvailability.createMany({
      data: windows.map((window) => {
        const props = window.toProps();
        return {
          id: props.id,
          menuItemId: props.menuItemId,
          restaurantId: props.restaurantId,
          dayOfWeek: props.dayOfWeek,
          startTime: props.startTime,
          endTime: props.endTime,
          createdAt: props.createdAt,
          updatedAt: props.updatedAt,
        };
      }),
    });
  }

  async deleteAllForMenuItem(menuItemId: MenuItemId): Promise<void> {
    await this.prismaContext.client.menuItemAvailability.deleteMany({
      where: { menuItemId: menuItemId.value },
    });
  }
}
