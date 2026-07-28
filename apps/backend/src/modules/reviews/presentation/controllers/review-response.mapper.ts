import { ReviewResult, ReviewListResult } from '../../application/dto/review.result';
import { ReviewImageUploadResult } from '../../application/dto/review-image.result';
import {
  ReviewResponseDto,
  ReviewListResponseDto,
  ReviewImageResponseDto,
} from '../dto/review.response.dto';

export function toReviewResponse(result: ReviewResult): ReviewResponseDto {
  return {
    reviewId: result.reviewId,
    restaurantId: result.restaurantId,
    reservationId: result.reservationId,
    reviewerUsername: result.reviewerUsername,
    rating: result.rating,
    comment: result.comment,
    images: result.images.map((image) => ({
      reviewImageId: image.reviewImageId,
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder,
    })),
    reply: result.reply
      ? { comment: result.reply.comment, createdAt: result.reply.createdAt.toISOString() }
      : null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toReviewListResponse(result: ReviewListResult): ReviewListResponseDto {
  return {
    items: result.items.map(toReviewResponse),
    page: result.page,
    limit: result.limit,
    total: result.total,
  };
}

export function toReviewImageResponse(result: ReviewImageUploadResult): ReviewImageResponseDto {
  return {
    reviewImageId: result.reviewImageId,
    imageUrl: result.imageUrl,
    sortOrder: result.sortOrder,
  };
}
