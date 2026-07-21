import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantCuisineCategoryRepository,
  RESTAURANT_CUISINE_CATEGORY_REPOSITORY,
} from '../../domain/repositories/restaurant-cuisine-category.repository';
import {
  CuisineCategoryRepository,
  CUISINE_CATEGORY_REPOSITORY,
} from '../../domain/repositories/cuisine-category.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { toCuisineCategoryResult } from '../mappers/cuisine-category-result.mapper';
import { GetRestaurantCuisineCategoriesCommand } from '../dto/get-restaurant-cuisine-categories.command';
import { RestaurantCuisineCategoriesResult } from '../dto/restaurant-cuisine-categories.result';

@Injectable()
export class GetRestaurantCuisineCategoriesUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_CUISINE_CATEGORY_REPOSITORY)
    private readonly restaurantCuisineCategoryRepository: RestaurantCuisineCategoryRepository,
    @Inject(CUISINE_CATEGORY_REPOSITORY)
    private readonly cuisineCategoryRepository: CuisineCategoryRepository,
  ) {}

  async execute(
    command: GetRestaurantCuisineCategoriesCommand,
  ): Promise<RestaurantCuisineCategoriesResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate: RestaurantCuisineCategory carries no
    // organizationId of its own (TENANCY.md's "transitively tenant-owned"
    // case, same as WorkingHours) - resolving the parent Restaurant through
    // the already-tenant-scoped RestaurantRepository first is what makes
    // this call safe.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const assignments =
      await this.restaurantCuisineCategoryRepository.findAllByRestaurantId(restaurantId);
    const categories = await this.cuisineCategoryRepository.findByIds(
      assignments.map((assignment) => assignment.cuisineCategoryId),
    );

    return {
      restaurantId: restaurantId.value,
      categories: [...categories]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => toCuisineCategoryResult(category)),
    };
  }
}
