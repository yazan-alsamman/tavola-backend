import { Injectable, Inject } from '@nestjs/common';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { GetReviewCommand } from '../dto/get-review.command';
import { ReviewResult } from '../dto/review.result';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26). Public read (`noauth`)
 * - `Review` is not tenant-scoped, so this is safe with no bound
 * `TenantContext` (unlike `ListRestaurantReviewsUseCase`'s Restaurant
 * existence check, no `DIRECT_TENANT_OWNED_MODEL` is touched here at all).
 */
@Injectable()
export class GetReviewUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: GetReviewCommand): Promise<ReviewResult> {
    const review = await this.reviewRepository.findById(ReviewId.create(command.reviewId));
    if (review === null) {
      throw new ReviewNotFoundException();
    }
    return this.resultAssembler.assemble(review);
  }
}
