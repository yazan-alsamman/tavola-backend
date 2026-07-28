import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import {
  AuthenticatedActor,
  AuthenticatedOrganizationMemberActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { SubmitReviewUseCase } from '../../application/use-cases/submit-review.use-case';
import { DeleteReviewUseCase } from '../../application/use-cases/delete-review.use-case';
import { ReplyToReviewUseCase } from '../../application/use-cases/reply-to-review.use-case';
import { AddReviewImageUseCase } from '../../application/use-cases/add-review-image.use-case';
import { DeleteReviewImageUseCase } from '../../application/use-cases/delete-review-image.use-case';
import { ListRestaurantReviewsUseCase } from '../../application/use-cases/list-restaurant-reviews.use-case';
import { ListMyReviewsUseCase } from '../../application/use-cases/list-my-reviews.use-case';
import { GetReviewUseCase } from '../../application/use-cases/get-review.use-case';
import { REVIEW_IMAGE_MAX_SIZE_BYTES } from '../../application/policies/review-image-upload.policy';
import { SubmitReviewRequestDto } from '../dto/submit-review.request.dto';
import { ReplyToReviewRequestDto } from '../dto/reply-to-review.request.dto';
import { ListReviewsQueryDto } from '../dto/list-reviews.query.dto';
import {
  ReviewResponseDto,
  ReviewListResponseDto,
  ReviewImageResponseDto,
} from '../dto/review.response.dto';
import {
  toReviewResponse,
  toReviewListResponse,
  toReviewImageResponse,
} from './review-response.mapper';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26,
 * TASKS.md's "Phase 10 — Reviews: Pre-implementation architecture
 * decisions"). Flat `reviews` resource for Customer-owned actions (mirrors
 * `ReservationsController`/`WaitlistController`'s own precedent), nested
 * `restaurants/:id/reviews` for the public restaurant-scoped listing only.
 * `DELETE /reviews/:id` is guarded only by `JwtAuthGuard`/`SessionVersionGuard`
 * - dual-actor (owning Customer or Restaurant Organization Owner/Admin)
 * authorization is resolved inside `DeleteReviewUseCase`. `POST
 * /reviews/:id/reply` is Organization Owner/Admin only, guarded by
 * `OrganizationMemberGuard`+`@RequireOrgRole` (no Employee path, no new
 * permission slug). No `PATCH /reviews/:id` exists - Reviews are immutable
 * after creation.
 */
@ApiTags('Reviews')
@ApiExtraModels(ErrorResponseDto)
@Controller({ version: '1' })
export class ReviewsController {
  constructor(
    private readonly submitReviewUseCase: SubmitReviewUseCase,
    private readonly deleteReviewUseCase: DeleteReviewUseCase,
    private readonly replyToReviewUseCase: ReplyToReviewUseCase,
    private readonly addReviewImageUseCase: AddReviewImageUseCase,
    private readonly deleteReviewImageUseCase: DeleteReviewImageUseCase,
    private readonly listRestaurantReviewsUseCase: ListRestaurantReviewsUseCase,
    private readonly listMyReviewsUseCase: ListMyReviewsUseCase,
    private readonly getReviewUseCase: GetReviewUseCase,
  ) {}

  @Post('reviews')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Review submitted successfully.')
  @ApiOperation({
    operationId: 'reviewsSubmit',
    summary: 'Submit a review for a completed reservation',
    description:
      'Reachable only by the Customer who owns the referenced reservation, only once it is Completed. Guest-only (Phone/WalkIn, no registered User) reservations are never eligible. Exactly one review may ever exist per reservation - enforced at both the application and database level; deleting a review never frees the reservation for resubmission. Immutable after creation - there is no Update Review endpoint.',
  })
  @ApiResponse({ status: 201, description: 'Review submitted', type: ReviewResponseDto })
  @ApiErrorResponse(400, 'Invalid rating/comment, or the reservation is not Completed', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Reservation not found, or does not belong to the caller', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'A review already exists for this reservation', ['CONFLICT'])
  async submit(
    @Body() body: SubmitReviewRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ReviewResponseDto> {
    const result = await this.submitReviewUseCase.execute({
      actor,
      reservationId: body.reservationId,
      rating: body.rating,
      comment: body.comment ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReviewResponse(result);
  }

  @Get('restaurants/:restaurantId/reviews')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant reviews retrieved successfully.')
  @ApiOperation({
    operationId: 'reviewsListForRestaurant',
    summary: "List a restaurant's public reviews",
    description:
      'Public, unauthenticated. Paginated, ordered newest-first. Only active (non-deleted) reviews are ever returned. Public Customer identity is username only - never real name, phone, email, or any ReservationGuest data.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant reviews retrieved',
    type: ReviewListResponseDto,
  })
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async listForRestaurant(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<ReviewListResponseDto> {
    const result = await this.listRestaurantReviewsUseCase.execute({
      restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return toReviewListResponse(result);
  }

  @Get('users/me/reviews')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Your reviews retrieved successfully.')
  @ApiOperation({
    operationId: 'reviewsListMine',
    summary: "List the authenticated Customer's own reviews",
    description: "Ownership-only, no RBAC. Always the caller's own reviews, paginated.",
  })
  @ApiResponse({ status: 200, description: 'Your reviews retrieved', type: ReviewListResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  async listMine(
    @Query() query: ListReviewsQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReviewListResponseDto> {
    const result = await this.listMyReviewsUseCase.execute({
      actor,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return toReviewListResponse(result);
  }

  @Get('reviews/:id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Review retrieved successfully.')
  @ApiOperation({
    operationId: 'reviewsGetById',
    summary: 'Get a single review by id',
    description: 'Public, unauthenticated - same visibility as the restaurant review listing.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Review retrieved', type: ReviewResponseDto })
  @ApiErrorResponse(404, 'Review not found (or deleted)', ['NOT_FOUND'])
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<ReviewResponseDto> {
    const result = await this.getReviewUseCase.execute({ reviewId: id });
    return toReviewResponse(result);
  }

  @Delete('reviews/:id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'reviewsDelete',
    summary: 'Soft-delete a review (Domain Action)',
    description:
      "Reachable by either the review's own Customer (ownership) or an Organization Owner/Admin of the Restaurant it belongs to - one route, no PermissionsGuard, actor branching resolved inside the use case. Employees may not delete reviews in Phase 10. Soft delete only - never frees the reservation for a new review, and Restaurant.averageRating is recomputed transactionally in the same transaction as the delete.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Review deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is an Employee, or a non-Owner/Admin organization member', [
    'FORBIDDEN',
  ])
  @ApiErrorResponse(404, 'Review not found, not owned by the caller, or cross-organization', [
    'NOT_FOUND',
  ])
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteReviewUseCase.execute({
      actor,
      reviewId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post('reviews/:id/reply')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reply added successfully.')
  @ApiOperation({
    operationId: 'reviewsReply',
    summary: 'Reply to a review (Domain Action, Organization Owner/Admin only)',
    description:
      'Organization Owner/Admin of the Restaurant the review belongs to - no Employee reply path in Phase 10, no reviews:reply (or any other) permission slug. Zero-or-one reply per review, enforced at both the application and database level. Immutable once created - no edit, delete, or repost.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reply added', type: ReviewResponseDto })
  @ApiErrorResponse(400, 'comment is missing or empty', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Review not found (or belongs to another organization)', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'This review already has a reply', ['CONFLICT'])
  async reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplyToReviewRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<ReviewResponseDto> {
    const result = await this.replyToReviewUseCase.execute({
      actor,
      reviewId: id,
      comment: body.comment,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReviewResponse(result);
  }

  @Post('reviews/:id/images')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: REVIEW_IMAGE_MAX_SIZE_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ResponseMessage('Review image added successfully.')
  @ApiOperation({
    operationId: 'reviewsAddImage',
    summary: 'Add an image to a review',
    description:
      'Owning Customer only. Accepts a single multipart image file (JPEG/PNG/WebP, 5MB max, validated by magic-byte signature). Reuses the existing Files/MinIO pipeline (FileOwnerType.Review). Maximum 5 active images per review.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Review image added', type: ReviewImageResponseDto })
  @ApiErrorResponse(400, 'Missing file or the file is not a valid supported image', [
    'VALIDATION_ERROR',
    'INVALID_FILE',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Review not found, or does not belong to the caller', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Review already has the maximum number of active images', [
    'REVIEW_IMAGE_LIMIT_EXCEEDED',
  ])
  @ApiErrorResponse(413, 'Review image file exceeds the maximum allowed size', ['FILE_TOO_LARGE'])
  @ApiErrorResponse(415, 'Unsupported review image file type', ['UNSUPPORTED_FILE_TYPE'])
  @ApiErrorResponse(503, 'Review image storage is temporarily unavailable', ['STORAGE_UNAVAILABLE'])
  async addImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ReviewImageResponseDto> {
    const result = await this.addReviewImageUseCase.execute({
      actor,
      reviewId: id,
      file: file ? { buffer: file.buffer, mimeType: file.mimetype, sizeBytes: file.size } : null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReviewImageResponse(result);
  }

  @Delete('reviews/:id/images/:imageId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'reviewsDeleteImage',
    summary: 'Delete an individual image from a review',
    description:
      "Owning Customer only. Soft-deletes the ReviewImage row and the underlying File record, using the existing Files infrastructure. Does not make the review's rating/comment editable, and does not itself delete the review.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Review image deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Review not found, does not belong to the caller, or image not found', [
    'NOT_FOUND',
  ])
  async deleteImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteReviewImageUseCase.execute({
      actor,
      reviewId: id,
      reviewImageId: imageId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
