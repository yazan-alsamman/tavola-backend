import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { ListRestaurantReviewsForStaffCommand } from '../dto/list-restaurant-reviews.command';
import { ReviewListResult } from '../dto/review.result';

/**
 * ADR-045: the restaurant's own review list - the public list's filters
 * plus each guest's private note. Owner/Admin of the restaurant's
 * organization only (route guard + the tenant-scoped `findById` here).
 */
@Injectable()
export class ListRestaurantReviewsForStaffUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: ListRestaurantReviewsForStaffCommand): Promise<ReviewListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null || restaurant.organizationId.value !== command.actor.organizationId) {
      throw new RestaurantNotFoundException();
    }

    const page = await this.reviewRepository.findManyByRestaurantId(
      restaurantId,
      command.page,
      command.limit,
      command.filter,
    );
    return {
      items: await this.resultAssembler.assembleMany(page.items),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
