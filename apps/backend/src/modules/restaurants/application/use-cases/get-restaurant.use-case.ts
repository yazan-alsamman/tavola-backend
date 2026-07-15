import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { toRestaurantResult } from '../mappers/restaurant-result.mapper';
import { GetRestaurantCommand } from '../dto/get-restaurant.command';
import { RestaurantResult } from '../dto/restaurant.result';

@Injectable()
export class GetRestaurantUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: GetRestaurantCommand): Promise<RestaurantResult> {
    const restaurant = await this.restaurantRepository.findById(
      RestaurantId.create(command.restaurantId),
    );
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    return toRestaurantResult(restaurant);
  }
}
