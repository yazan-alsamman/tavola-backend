import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { ListRestaurantReviewsCommand } from '../dto/list-restaurant-reviews.command';
import { ReviewListResult } from '../dto/review.result';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decisions
 * #13/#26). Public read (`noauth`) - ordered newest-first, existing
 * `page`/`limit`/`total` pagination convention, no cursor pagination
 * invented for this phase. Only active (non-deleted) Reviews are ever
 * returned - `ReviewRepository`'s own `findManyByRestaurantId` already
 * excludes `deletedAt IS NOT NULL` rows.
 */
@Injectable()
export class ListRestaurantReviewsUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: ListRestaurantReviewsCommand): Promise<ReviewListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Public route - no bound TenantContext.organizationId at all, so the
    // ordinary tenant-scoped `findById` (fail-closed on `Restaurant`, a
    // `DIRECT_TENANT_OWNED_MODEL`) cannot be used here. `existsPubliclyById`
    // is the dedicated, narrow, boolean-only existence check for exactly
    // this case - see its own doc comment on `RestaurantRepository`.
    const exists = await this.restaurantRepository.existsPubliclyById(restaurantId);
    if (!exists) {
      throw new RestaurantNotFoundException();
    }

    const page = await this.reviewRepository.findManyByRestaurantId(
      restaurantId,
      command.page,
      command.limit,
    );

    return {
      items: await this.resultAssembler.assembleMany(page.items),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
