import { Injectable, Inject } from '@nestjs/common';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { toRestaurantResult } from '../mappers/restaurant-result.mapper';
import { ListRestaurantsCommand } from '../dto/list-restaurants.command';
import { RestaurantListResult } from '../dto/restaurant-list.result';

@Injectable()
export class ListRestaurantsUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: ListRestaurantsCommand): Promise<RestaurantListResult> {
    const { items, total } = await this.restaurantRepository.findMany(command.page, command.limit);

    return {
      items: items.map(toRestaurantResult),
      page: command.page,
      limit: command.limit,
      total,
    };
  }
}
