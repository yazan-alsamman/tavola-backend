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
  Put,
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
import { ListRestaurantReviewsForStaffUseCase } from '../../application/use-cases/list-restaurant-reviews-for-staff.use-case';
import { ReopenReviewUseCase } from '../../application/use-cases/reopen-review.use-case';
import { RerateReviewUseCase } from '../../application/use-cases/rerate-review.use-case';
import { REVIEW_IMAGE_MAX_SIZE_BYTES } from '../../application/policies/review-image-upload.policy';
import { ReviewContentRequestDto, SubmitReviewRequestDto } from '../dto/submit-review.request.dto';
import { ReplyToReviewRequestDto } from '../dto/reply-to-review.request.dto';
import { ListReviewsQueryDto } from '../dto/list-reviews.query.dto';
import {
  ReviewResponseDto,
  ReviewListResponseDto,
  ReviewImageResponseDto,
  StaffReviewResponseDto,
  StaffReviewListResponseDto,
} from '../dto/review.response.dto';
import {
  toReviewContent,
  toReviewResponse,
  toReviewListResponse,
  toReviewImageResponse,
  toStaffReviewResponse,
  toStaffReviewListResponse,
} from './review-response.mapper';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26,
 * TASKS.md's "Phase 10 — Reviews: Pre-implementation architecture
 * decisions"). Flat `reviews` resource for Customer-owned actions (mirrors
 * `ReservationsController`/`WaitlistController`'s own precedent), nested
 * `restaurants/:id/reviews` for the public restaurant-scoped listing only.
 * `DELETE /reviews/:id` is the review's own Customer only (ADR-045).
 * `POST /reviews/:id/reply`, `POST /reviews/:id/reopen` and the `manage`
 * list are Organization Owner/Admin only (`OrganizationMemberGuard` +
 * `@RequireOrgRole`). `PUT /reviews/:id` (re-rate) is the review's own
 * Customer, only while the restaurant has it open.
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
    private readonly listRestaurantReviewsForStaffUseCase: ListRestaurantReviewsForStaffUseCase,
    private readonly reopenReviewUseCase: ReopenReviewUseCase,
    private readonly rerateReviewUseCase: RerateReviewUseCase,
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
      'Reachable only by the Customer who owns the referenced reservation, only once it is Completed. Guest-only (no registered User) reservations are never eligible. Exactly one review may ever exist per reservation - enforced at both the application and database level; deleting a review never frees the reservation for resubmission. Send `axes` (service, place, food: stars and a comment each; the score is their average) or `rating` alone (app 1.0.2). `privateNote` reaches the restaurant only. The guest can change it only after the restaurant reopens it (PUT /reviews/:id).',
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
      content: toReviewContent(body),
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
      filter: { axis: query.axis, stars: query.stars },
    });
    return toReviewListResponse(result);
  }

  @Get('restaurants/:restaurantId/reviews/manage')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant reviews retrieved successfully.')
  @ApiOperation({
    operationId: 'reviewsListForRestaurantStaff',
    summary: "List a restaurant's reviews with guests' private notes (Owner/Admin)",
    description:
      "The public list's filters (`axis`, `stars`) plus each guest's `privateNote`, which is never published. Organization Owner/Admin of the restaurant only.",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant reviews retrieved',
    type: StaffReviewListResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async listForRestaurantStaff(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: ListReviewsQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<StaffReviewListResponseDto> {
    const result = await this.listRestaurantReviewsForStaffUseCase.execute({
      actor,
      restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      filter: { axis: query.axis, stars: query.stars },
    });
    return toStaffReviewListResponse(result);
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
      "Only the review's own Customer. The restaurant (Owner, Admin, Employee) never deletes reviews (ADR-045). Soft delete only - never frees the reservation for a new review, and the restaurant rating is recomputed in the same transaction.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Review deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is a restaurant actor (restaurants never delete reviews)', [
    'FORBIDDEN',
  ])
  @ApiErrorResponse(404, 'Review not found, or not owned by the caller', ['NOT_FOUND'])
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

  @Post('reviews/:id/reopen')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Review opened for re-rating.')
  @ApiOperation({
    operationId: 'reviewsReopen',
    summary: 'Open a review for its guest to rate again (Owner/Admin)',
    description:
      'After talking to the guest, the restaurant lets them rate again. Nothing changes until the guest does (PUT /reviews/:id); the decision stays theirs. Idempotent while already open.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Review opened', type: StaffReviewResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Review not found (or belongs to another organization)', ['NOT_FOUND'])
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<StaffReviewResponseDto> {
    const result = await this.reopenReviewUseCase.execute({
      actor,
      reviewId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toStaffReviewResponse(result);
  }

  @Put('reviews/:id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Review updated successfully.')
  @ApiOperation({
    operationId: 'reviewsRerate',
    summary: 'Rate again a review the restaurant reopened (review owner only)',
    description:
      'Same body as submit, without `reservationId`. Allowed only while `openForRerating` is true; the new rating replaces the old one and closes the window.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Review rated again', type: ReviewResponseDto })
  @ApiErrorResponse(400, 'Invalid rating, axes or comment', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Review not found, or not owned by the caller', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'The restaurant has not opened this review for re-rating', ['CONFLICT'])
  async rerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewContentRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ReviewResponseDto> {
    const result = await this.rerateReviewUseCase.execute({
      actor,
      reviewId: id,
      content: toReviewContent(body),
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
