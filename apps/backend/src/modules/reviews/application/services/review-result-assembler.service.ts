import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { Review } from '../../domain/entities/review.entity';
import {
  ReviewImageRepository,
  REVIEW_IMAGE_REPOSITORY,
} from '../../domain/repositories/review-image.repository';
import {
  RestaurantReplyRepository,
  RESTAURANT_REPLY_REPOSITORY,
} from '../../domain/repositories/restaurant-reply.repository';
import { ReviewResult } from '../dto/review.result';

/**
 * Shared read-side assembler (Phase 10) - every use case that returns a
 * Review to a client (Submit/Delete/Reply/Get/List) goes through this one
 * place, so the public projection rule (owner decision #14: `username`
 * only, never `userId`/real name/PII) and the reply/images embedding are
 * enforced identically everywhere, never duplicated per use case.
 */
@Injectable()
export class ReviewResultAssembler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(REVIEW_IMAGE_REPOSITORY) private readonly reviewImageRepository: ReviewImageRepository,
    @Inject(RESTAURANT_REPLY_REPOSITORY)
    private readonly restaurantReplyRepository: RestaurantReplyRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
  ) {}

  async assemble(review: Review): Promise<ReviewResult> {
    const [user, images, reply] = await Promise.all([
      this.userRepository.findById(review.userId),
      this.reviewImageRepository.findManyByReviewId(review.reviewId),
      this.restaurantReplyRepository.findByReviewId(review.reviewId),
    ]);

    const imageResults = await Promise.all(
      images.map(async (image) => {
        const file = await this.fileRepository.findById(image.fileId);
        const imageUrl = file
          ? await this.storagePort.getSignedReadUrl(file.bucket, file.objectKey)
          : null;
        return {
          reviewImageId: image.reviewImageId.value,
          imageUrl: imageUrl ?? '',
          sortOrder: image.sortOrder,
        };
      }),
    );

    return {
      reviewId: review.reviewId.value,
      restaurantId: review.restaurantId.value,
      reservationId: review.reservationId.value,
      reviewerUsername: user?.username ?? null,
      rating: review.rating,
      comment: review.comment,
      images: imageResults,
      reply: reply ? { comment: reply.comment, createdAt: reply.createdAt } : null,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  async assembleMany(reviews: Review[]): Promise<ReviewResult[]> {
    return Promise.all(reviews.map((review) => this.assemble(review)));
  }
}
