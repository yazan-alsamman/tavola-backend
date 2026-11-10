import { ReviewResult, ReviewListResult } from '../../application/dto/review.result';
import { ReviewContent } from '../../domain/entities/review.entity';
import { ReviewContentRequestDto } from '../dto/submit-review.request.dto';
import { ReviewImageUploadResult } from '../../application/dto/review-image.result';
import {
  ReviewResponseDto,
  ReviewListResponseDto,
  ReviewImageResponseDto,
  StaffReviewResponseDto,
  StaffReviewListResponseDto,
} from '../dto/review.response.dto';

export function toReviewResponse(result: ReviewResult): ReviewResponseDto {
  return {
    reviewId: result.reviewId,
    restaurantId: result.restaurantId,
    reservationId: result.reservationId,
    reviewerUsername: result.reviewerUsername,
    rating: result.rating,
    comment: result.comment,
    score: result.score,
    axes: result.axes
      ? {
          service: { ...result.axes.service },
          place: { ...result.axes.place },
          food: { ...result.axes.food },
        }
      : null,
    openForRerating: result.openForRerating,
    reratedAt: result.reratedAt ? result.reratedAt.toISOString() : null,
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

export function toStaffReviewResponse(result: ReviewResult): StaffReviewResponseDto {
  return { ...toReviewResponse(result), privateNote: result.privateNote };
}

export function toStaffReviewListResponse(result: ReviewListResult): StaffReviewListResponseDto {
  return {
    items: result.items.map(toStaffReviewResponse),
    page: result.page,
    limit: result.limit,
    total: result.total,
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

/** Request body -> domain review content (submit and re-rate). */
export function toReviewContent(body: ReviewContentRequestDto): ReviewContent {
  return {
    rating: body.rating ?? null,
    comment: body.comment ?? null,
    axes: body.axes
      ? {
          service: { rating: body.axes.service.rating, comment: body.axes.service.comment ?? null },
          place: { rating: body.axes.place.rating, comment: body.axes.place.comment ?? null },
          food: { rating: body.axes.food.rating, comment: body.axes.food.comment ?? null },
        }
      : null,
    privateNote: body.privateNote ?? null,
  };
}
