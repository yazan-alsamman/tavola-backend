import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { ListMyReviewsCommand } from '../dto/list-my-reviews.command';
import { ReviewListResult } from '../dto/review.result';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26). Ownership-only, no
 * RBAC - mirrors `/users/me/favorites`'s own precedent exactly. Always the
 * caller's own reviews (from the JWT), never a client-supplied userId.
 */
@Injectable()
export class ListMyReviewsUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: ListMyReviewsCommand): Promise<ReviewListResult> {
    const userId = UserId.create(command.actor.userId);
    const page = await this.reviewRepository.findManyByUserId(userId, command.page, command.limit);

    return {
      items: await this.resultAssembler.assembleMany(page.items),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
