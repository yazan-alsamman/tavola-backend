import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
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
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { resolveClientIp } from '@modules/authentication/presentation/utils/resolve-client-ip.util';
import { GetCurrentUserProfileUseCase } from '../../application/use-cases/get-current-user-profile.use-case';
import { UpdateUserProfileUseCase } from '../../application/use-cases/update-user-profile.use-case';
import { UploadCurrentUserAvatarUseCase } from '../../application/use-cases/upload-current-user-avatar.use-case';
import { AddFavoriteUseCase } from '../../application/use-cases/add-favorite.use-case';
import { RemoveFavoriteUseCase } from '../../application/use-cases/remove-favorite.use-case';
import { ListCurrentUserFavoritesUseCase } from '../../application/use-cases/list-current-user-favorites.use-case';
import { GetCurrentUserPreferencesUseCase } from '../../application/use-cases/get-current-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from '../../application/use-cases/update-user-preferences.use-case';
import { RequestAccountDeletionUseCase } from '../../application/use-cases/request-account-deletion.use-case';
import { CancelAccountDeletionUseCase } from '../../application/use-cases/cancel-account-deletion.use-case';
import { ExportUserDataUseCase } from '../../application/use-cases/export-user-data.use-case';
import { UserProfileResult } from '../../application/dto/user-profile.result';
import { UploadCurrentUserAvatarResult } from '../../application/dto/upload-current-user-avatar.result';
import { FavoriteResult } from '../../application/dto/favorite.result';
import { FavoriteListResult } from '../../application/dto/favorite-list.result';
import { UserPreferencesResult } from '../../application/dto/user-preferences.result';
import { ExportUserDataResult } from '../../application/dto/export-user-data.result';
import { AVATAR_MAX_SIZE_BYTES } from '../../application/policies/avatar-upload.policy';
import { UpdateUserProfileRequestDto } from '../dto/update-user-profile.request.dto';
import { UserProfileResponseDto } from '../dto/user-profile.response.dto';
import { UploadAvatarResponseDto } from '../dto/upload-avatar.response.dto';
import { ListFavoritesQueryDto } from '../dto/list-favorites.query.dto';
import { FavoriteResponseDto } from '../dto/favorite.response.dto';
import { FavoriteListResponseDto } from '../dto/favorite-list.response.dto';
import { UpdateUserPreferencesRequestDto } from '../dto/update-user-preferences.request.dto';
import { UserPreferencesResponseDto } from '../dto/user-preferences.response.dto';
import { DeleteAccountRequestDto } from '../dto/delete-account.request.dto';
import { DeleteAccountResponseDto } from '../dto/delete-account.response.dto';
import { ExportUserDataResponseDto } from '../dto/export-user-data.response.dto';
import { toReservationResponse } from '@modules/reservations/presentation/controllers/reservation-response.mapper';
import { toReviewResponse } from '@modules/reviews/presentation/controllers/review-response.mapper';

@ApiTags('Users')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly getCurrentUserProfileUseCase: GetCurrentUserProfileUseCase,
    private readonly updateUserProfileUseCase: UpdateUserProfileUseCase,
    private readonly uploadCurrentUserAvatarUseCase: UploadCurrentUserAvatarUseCase,
    private readonly addFavoriteUseCase: AddFavoriteUseCase,
    private readonly removeFavoriteUseCase: RemoveFavoriteUseCase,
    private readonly listCurrentUserFavoritesUseCase: ListCurrentUserFavoritesUseCase,
    private readonly getCurrentUserPreferencesUseCase: GetCurrentUserPreferencesUseCase,
    private readonly updateUserPreferencesUseCase: UpdateUserPreferencesUseCase,
    private readonly requestAccountDeletionUseCase: RequestAccountDeletionUseCase,
    private readonly cancelAccountDeletionUseCase: CancelAccountDeletionUseCase,
    private readonly exportUserDataUseCase: ExportUserDataUseCase,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Profile retrieved successfully.')
  @ApiOperation({
    operationId: 'usersGetCurrentProfile',
    summary: "Get the authenticated user's own profile",
    description:
      'Returns only the profile fields owned by the User Module (name, phone, language, preferredCurrency) - never credentials, session, or authorization internals. The target is always the caller (from the JWT), never a client-supplied id.',
  })
  @ApiResponse({ status: 200, description: 'Profile retrieved', type: UserProfileResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'No user found for the authenticated actor', ['NOT_FOUND'])
  async getCurrentProfile(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<UserProfileResponseDto> {
    const result = await this.getCurrentUserProfileUseCase.execute({ actor });
    return this.toResponse(result);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Profile updated successfully.')
  @ApiOperation({
    operationId: 'usersUpdateCurrentProfile',
    summary: "Update the authenticated user's own profile",
    description:
      'Full-replace update of name, phone, language, and preferredCurrency for the caller only (from the JWT, never a client-supplied id). Does not accept email, password, or any Authentication/Authorization field - those have their own dedicated endpoints.',
  })
  @ApiResponse({ status: 200, description: 'Profile updated', type: UserProfileResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'No user found for the authenticated actor', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'This phone number already belongs to another account', ['CONFLICT'])
  async updateCurrentProfile(
    @Body() body: UpdateUserProfileRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<UserProfileResponseDto> {
    const result = await this.updateUserProfileUseCase.execute({
      actor,
      firstName: body.firstName,
      lastName: body.lastName,
      countryCode: body.countryCode ?? null,
      phoneNumber: body.phoneNumber ?? null,
      language: body.language,
      preferredCurrency: body.preferredCurrency ?? null,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get('me/preferences')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Preferences retrieved successfully.')
  @ApiOperation({
    operationId: 'usersGetCurrentPreferences',
    summary: "Get the authenticated user's own notification/marketing preferences",
    description:
      'Returns only notificationOptIn/marketingOptIn - never language or preferredCurrency, which remain part of the User Profile contract (GET/PATCH /users/me). The target is always the caller (from the JWT), never a client-supplied id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Preferences retrieved',
    type: UserPreferencesResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'No user found for the authenticated actor', ['NOT_FOUND'])
  async getCurrentPreferences(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<UserPreferencesResponseDto> {
    const result = await this.getCurrentUserPreferencesUseCase.execute({ actor });
    return this.toPreferencesResponse(result);
  }

  @Patch('me/preferences')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Preferences updated successfully.')
  @ApiOperation({
    operationId: 'usersUpdateCurrentPreferences',
    summary: "Update the authenticated user's own notification/marketing preferences",
    description:
      'Full-replace update of notificationOptIn/marketingOptIn for the caller only (from the JWT, never a client-supplied id). Does not accept language, preferredCurrency, or any other User Profile field - those have their own dedicated endpoint (PATCH /users/me).',
  })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated',
    type: UserPreferencesResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure (missing or non-boolean field)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'No user found for the authenticated actor', ['NOT_FOUND'])
  async updateCurrentPreferences(
    @Body() body: UpdateUserPreferencesRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<UserPreferencesResponseDto> {
    const result = await this.updateUserPreferencesUseCase.execute({
      actor,
      notificationOptIn: body.notificationOptIn,
      marketingOptIn: body.marketingOptIn,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toPreferencesResponse(result);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_SIZE_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ResponseMessage('Avatar uploaded successfully.')
  @ApiOperation({
    operationId: 'usersUploadCurrentAvatar',
    summary: "Upload or replace the authenticated user's avatar",
    description:
      'Accepts a single multipart image file (JPEG/PNG/WebP, 5MB max, validated by magic-byte signature - not just Content-Type) for the caller only (from the JWT, never a client-supplied id). Replaces any existing avatar; the previous object is cleaned up only after the new one is durably persisted.',
  })
  @ApiResponse({ status: 200, description: 'Avatar uploaded', type: UploadAvatarResponseDto })
  @ApiErrorResponse(400, 'Missing file or the file is not a valid supported image', [
    'VALIDATION_ERROR',
    'INVALID_FILE',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'No user found for the authenticated actor', ['NOT_FOUND'])
  @ApiErrorResponse(413, 'Avatar file exceeds the maximum allowed size', ['FILE_TOO_LARGE'])
  @ApiErrorResponse(415, 'Unsupported avatar file type', ['UNSUPPORTED_FILE_TYPE'])
  @ApiErrorResponse(503, 'Avatar storage is temporarily unavailable', ['STORAGE_UNAVAILABLE'])
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<UploadAvatarResponseDto> {
    const result = await this.uploadCurrentUserAvatarUseCase.execute({
      actor,
      file: file ? { buffer: file.buffer, mimeType: file.mimetype, sizeBytes: file.size } : null,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toAvatarResponse(result);
  }

  @Post('me/favorites/:restaurantId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant added to favorites.')
  @ApiOperation({
    operationId: 'usersAddFavorite',
    summary: "Add a restaurant to the authenticated user's favorites",
    description:
      'Idempotent: favoriting an already-favorited restaurant succeeds and returns the existing favorite rather than erroring. The target is always the caller (from the JWT), never a client-supplied userId.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Favorite added (or already existed)',
    type: FavoriteResponseDto,
  })
  @ApiErrorResponse(400, 'restaurantId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async addFavorite(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<FavoriteResponseDto> {
    const result = await this.addFavoriteUseCase.execute({
      actor,
      restaurantId,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toFavoriteResponse(result);
  }

  @Delete('me/favorites/:restaurantId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'usersRemoveFavorite',
    summary: "Remove a restaurant from the authenticated user's favorites",
    description:
      'Idempotent: removing a favorite that does not exist (already removed, never existed, or belongs to another user) is a silent no-op - always 204. The target is always the caller (from the JWT), never a client-supplied userId.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Favorite removed (or already absent)' })
  @ApiErrorResponse(400, 'restaurantId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  async removeFavorite(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.removeFavoriteUseCase.execute({
      actor,
      restaurantId,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Get('me/favorites')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Favorites retrieved successfully.')
  @ApiOperation({
    operationId: 'usersListFavorites',
    summary: "List the authenticated user's favorite restaurants",
    description:
      "Paginated, ordered most-recently-favorited first. Only the caller's own favorites (from the JWT, never a client-supplied userId). A favorite whose restaurant has since been deleted is silently excluded from the returned items.",
  })
  @ApiResponse({ status: 200, description: 'Favorites retrieved', type: FavoriteListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  async listFavorites(
    @Query() query: ListFavoritesQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<FavoriteListResponseDto> {
    const result = await this.listCurrentUserFavoritesUseCase.execute({
      actor,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return this.toFavoriteListResponse(result);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account deletion requested. You have until the grace period ends to cancel.')
  @ApiOperation({
    operationId: 'usersDeleteCurrentAccount',
    summary: "Request deletion of the authenticated Customer's own account",
    description:
      'ADR-014: anonymization-in-place, never immediate physical deletion. Requires the current password. Immediately revokes every DeviceSession/TokenFamily (logs out every device) and auto-cancels any active waitlist entries. Rejected (409) while any Pending/Approved reservation exists - cancel it first via the existing reservation cancellation flow, then retry. Irreversible anonymization executes automatically after SystemConfiguration.anonymizationGracePeriodDays (default 30) unless cancelled first via POST /users/me/cancel-deletion. Customer-only - never reachable by Employee/OrganizationMember/PlatformAdmin actors. Idempotent: repeating this call while a request is already pending re-verifies the password but does not reschedule.',
  })
  @ApiResponse({
    status: 200,
    description: 'Deletion requested; anonymization scheduled',
    type: DeleteAccountResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure (missing/too-short password)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing/invalid/expired, or the password is incorrect', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
    'AUTH_INVALID_CREDENTIALS',
  ])
  @ApiErrorResponse(403, 'Account locked/suspended, or the actor is not a Customer', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
    'FORBIDDEN',
  ])
  @ApiErrorResponse(409, 'An upcoming reservation is blocking deletion', [
    'OPEN_RESERVATIONS_BLOCK_DELETION',
  ])
  async deleteCurrentAccount(
    @Body() body: DeleteAccountRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<DeleteAccountResponseDto> {
    const result = await this.requestAccountDeletionUseCase.execute({
      actor,
      password: body.password,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return { scheduledAnonymizationAt: result.scheduledAnonymizationAt.toISOString() };
  }

  @Post('me/cancel-deletion')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'usersCancelCurrentAccountDeletion',
    summary: 'Cancel a pending account deletion request within the grace period',
    description:
      'No password required - a freshly-issued JWT (obtained by logging back in, since requesting deletion already revoked every prior session) is already proof of credential possession. Idempotent: calling this with no pending request is a silent success.',
  })
  @ApiResponse({ status: 204, description: 'Deletion request cancelled (or none was pending)' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'The actor is not a Customer', ['FORBIDDEN'])
  async cancelCurrentAccountDeletion(
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.cancelAccountDeletionUseCase.execute({
      actor,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Get('me/export')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Data export generated successfully.')
  @ApiOperation({
    operationId: 'usersExportCurrentUserData',
    summary: "Export the authenticated user's own data (GDPR right to portability)",
    description:
      'ADR-014 §5: offered before/during the account deletion flow, never only after. Aggregates Profile, Preferences, Reservations, Reviews, and Favorites via the same use cases their own dedicated endpoints already use - MVP scope, capped at 1000 records per category.',
  })
  @ApiResponse({
    status: 200,
    description: 'Data export generated',
    type: ExportUserDataResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  async exportCurrentUserData(
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ExportUserDataResponseDto> {
    const result = await this.exportUserDataUseCase.execute({
      actor,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toExportResponse(result);
  }

  private toFavoriteResponse(result: FavoriteResult): FavoriteResponseDto {
    return {
      restaurantId: result.restaurantId,
      favoritedAt: result.favoritedAt.toISOString(),
    };
  }

  private toFavoriteListResponse(result: FavoriteListResult): FavoriteListResponseDto {
    return {
      items: result.items.map((item) => ({
        restaurantId: item.restaurantId,
        name: item.name,
        slug: item.slug,
        cuisineType: item.cuisineType,
        priceLevel: item.priceLevel,
        averageRating: item.averageRating,
        status: item.status,
        favoritedAt: item.favoritedAt.toISOString(),
      })),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  private toPreferencesResponse(result: UserPreferencesResult): UserPreferencesResponseDto {
    return {
      userId: result.userId,
      notificationOptIn: result.notificationOptIn,
      marketingOptIn: result.marketingOptIn,
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toAvatarResponse(result: UploadCurrentUserAvatarResult): UploadAvatarResponseDto {
    return {
      avatarId: result.avatarId,
      avatarUrl: result.avatarUrl,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      uploadedAt: result.uploadedAt.toISOString(),
    };
  }

  private toExportResponse(result: ExportUserDataResult): ExportUserDataResponseDto {
    return {
      exportedAt: result.exportedAt.toISOString(),
      profile: this.toResponse(result.profile),
      preferences: this.toPreferencesResponse(result.preferences),
      reservations: {
        items: result.reservations.items.map(toReservationResponse),
        total: result.reservations.total,
      },
      reviews: {
        items: result.reviews.items.map(toReviewResponse),
        total: result.reviews.total,
      },
      favorites: {
        items: result.favorites.items.map((item) => ({
          restaurantId: item.restaurantId,
          name: item.name,
          slug: item.slug,
          cuisineType: item.cuisineType,
          priceLevel: item.priceLevel,
          averageRating: item.averageRating,
          status: item.status,
          favoritedAt: item.favoritedAt.toISOString(),
        })),
        total: result.favorites.total,
      },
    };
  }

  private toResponse(result: UserProfileResult): UserProfileResponseDto {
    return {
      userId: result.userId,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      phone: result.phone,
      language: result.language,
      preferredCurrency: result.preferredCurrency,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }
}
