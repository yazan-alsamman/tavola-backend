import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { MenuRepository, MENU_REPOSITORY } from '../../domain/repositories/menu.repository';
import { toMenuResult } from '../mappers/menu-result.mapper';
import { ListRestaurantMenusCommand } from '../dto/menu.commands';
import { MenuResult } from '../dto/menu.result';

/**
 * Customer-facing public read (DOMAIN_MODEL.md "List Restaurant Menus") -
 * corrected by ADR-032 from a single-resource read to a collection read,
 * since a Restaurant may now own more than one Menu. Unpaginated - the
 * expected cardinality per Restaurant (a handful of dayparts/channels) is
 * far below any pagination threshold this codebase uses elsewhere.
 * Uses `existsPubliclyById` rather than the tenant-scoped `findById`, since
 * this route has no bound `TenantContext` at all (unauthenticated).
 */
@Injectable()
export class ListRestaurantMenusUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository,
  ) {}

  async execute(command: ListRestaurantMenusCommand): Promise<MenuResult[]> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const exists = await this.restaurantRepository.existsPubliclyById(restaurantId);
    if (!exists) {
      throw new RestaurantNotFoundException();
    }

    const menus = await this.menuRepository.findManyByRestaurantId(restaurantId);
    return menus.filter((menu) => menu.active).map(toMenuResult);
  }
}
