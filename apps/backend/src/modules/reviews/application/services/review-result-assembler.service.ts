import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { Review } from '../../domain/entities/review.entity';
import { ReviewImage } from '../../domain/entities/review-image.entity';
import { RestaurantReply } from '../../domain/entities/restaurant-reply.entity';
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
 *
 * Phase 15 (Optimization): `assembleMany` batches every relation lookup by
 * type (one `findManyByIds`/`findManyByReviewIds` call per relation across
 * the whole page) instead of fanning out per Review - repository calls
 * scale by relation type (O(1)), not by Review count (O(N)). `assemble`
 * (single-Review path) is kept as a thin wrapper over the same batching
 * logic so Submit/Delete/Reply's one-Review call sites are unaffected.
 * `getSignedReadUrl` remains per-image (it is local HMAC pre-signing, not a
 * network round-trip - see `MinioFileStorageService`) but is no longer
 * gated behind a per-image database lookup.
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
    const [result] = await this.assembleMany([review]);
    return result;
  }

  async assembleMany(reviews: Review[]): Promise<ReviewResult[]> {
    if (reviews.length === 0) {
      return [];
    }

    // Deduplication happens value-wise inside each repository's
    // `findManyByIds`/`findManyByReviewIds` (VOs are distinct object
    // instances even for the same underlying id, so a plain `Set` here
    // would not actually dedupe) - passing the raw per-Review arrays is
    // correct and still yields exactly one query per relation type.
    const userIds = reviews.map((review) => review.userId);
    const reviewIds = reviews.map((review) => review.reviewId);

    const [users, images, replies] = await Promise.all([
      this.userRepository.findManyByIds(userIds),
      this.reviewImageRepository.findManyByReviewIds(reviewIds),
      this.restaurantReplyRepository.findManyByReviewIds(reviewIds),
    ]);

    const fileIds = images.map((image) => image.fileId);
    const files = await this.fileRepository.findManyByIds(fileIds);

    const usersById = new Map(users.map((user) => [user.userId.value, user]));
    const filesById = new Map(files.map((file) => [file.fileId.value, file]));
    const repliesByReviewId = new Map(replies.map((reply) => [reply.reviewId.value, reply]));
    const imagesByReviewId = new Map<string, ReviewImage[]>();
    for (const image of images) {
      const key = image.reviewId.value;
      const existing = imagesByReviewId.get(key);
      if (existing) {
        existing.push(image);
      } else {
        imagesByReviewId.set(key, [image]);
      }
    }

    return Promise.all(
      reviews.map((review) =>
        this.toResult(
          review,
          usersById.get(review.userId.value)?.username ?? null,
          imagesByReviewId.get(review.reviewId.value) ?? [],
          repliesByReviewId.get(review.reviewId.value) ?? null,
          filesById,
        ),
      ),
    );
  }

  private async toResult(
    review: Review,
    reviewerUsername: string | null,
    images: ReviewImage[],
    reply: RestaurantReply | null,
    filesById: Map<string, FileRecord>,
  ): Promise<ReviewResult> {
    const imageResults = await Promise.all(
      images.map(async (image) => {
        const file = filesById.get(image.fileId.value);
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
      reviewerUsername,
      rating: review.rating,
      comment: review.comment,
      images: imageResults,
      reply: reply ? { comment: reply.comment, createdAt: reply.createdAt } : null,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}
