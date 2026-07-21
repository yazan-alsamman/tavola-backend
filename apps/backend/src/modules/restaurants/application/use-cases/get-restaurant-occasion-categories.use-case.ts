import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantOccasionCategoryRepository,
  RESTAURANT_OCCASION_CATEGORY_REPOSITORY,
} from '../../domain/repositories/restaurant-occasion-category.repository';
import {
  OccasionCategoryRepository,
  OCCASION_CATEGORY_REPOSITORY,
} from '../../domain/repositories/occasion-category.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { toOccasionCategoryResult } from '../mappers/occasion-category-result.mapper';
import { GetRestaurantOccasionCategoriesCommand } from '../dto/get-restaurant-occasion-categories.command';
import { RestaurantOccasionCategoriesResult } from '../dto/restaurant-occasion-categories.result';

@Injectable()
export class GetRestaurantOccasionCategoriesUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_OCCASION_CATEGORY_REPOSITORY)
    private readonly restaurantOccasionCategoryRepository: RestaurantOccasionCategoryRepository,
    @Inject(OCCASION_CATEGORY_REPOSITORY)
    private readonly occasionCategoryRepository: OccasionCategoryRepository,
  ) {}

  async execute(
    command: GetRestaurantOccasionCategoriesCommand,
  ): Promise<RestaurantOccasionCategoriesResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see GetRestaurantCuisineCategoriesUseCase's own
    // comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const assignments =
      await this.restaurantOccasionCategoryRepository.findAllByRestaurantId(restaurantId);
    const categories = await this.occasionCategoryRepository.findByIds(
      assignments.map((assignment) => assignment.occasionCategoryId),
    );

    return {
      restaurantId: restaurantId.value,
      categories: [...categories]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => toOccasionCategoryResult(category)),
    };
  }
}
