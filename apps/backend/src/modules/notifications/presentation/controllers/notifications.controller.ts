import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { ListNotificationsUseCase } from '../../application/use-cases/list-notifications.use-case';
import { MarkNotificationReadUseCase } from '../../application/use-cases/mark-notification-read.use-case';
import { MarkAllNotificationsReadUseCase } from '../../application/use-cases/mark-all-notifications-read.use-case';
import { GetUnreadNotificationCountUseCase } from '../../application/use-cases/get-unread-notification-count.use-case';
import { GetOneSignalIdentityTokenUseCase } from '../../application/use-cases/get-onesignal-identity-token.use-case';
import { NotificationResult } from '../../application/dto/notification.result';
import { NotificationListResult } from '../../application/dto/notification-list.result';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto';
import { NotificationResponseDto } from '../dto/notification.response.dto';
import { NotificationListResponseDto } from '../dto/notification-list.response.dto';
import { UnreadCountResponseDto } from '../dto/unread-count.response.dto';
import { OneSignalIdentityTokenResponseDto } from '../dto/onesignal-identity-token.response.dto';

/**
 * API_GUIDELINES.md's frozen "Notification Endpoints" (Phase 9, architecture
 * frozen 2026-07-25). Ownership-only authorization
 * (`AUTHORIZATION_ARCHITECTURE.md` §10 - `notification.userId ===
 * principal.userId`) - no RBAC permission slug, no organization/tenant
 * context requirement (`Notification` is `userId`-owned only, see
 * `TENANCY.md`). Every route target is always the caller (from the JWT),
 * never a client-supplied `userId`, mirroring `UsersController`'s own
 * `/users/me/*` precedent exactly.
 */
@ApiTags('Notifications')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly listNotificationsUseCase: ListNotificationsUseCase,
    private readonly markNotificationReadUseCase: MarkNotificationReadUseCase,
    private readonly markAllNotificationsReadUseCase: MarkAllNotificationsReadUseCase,
    private readonly getUnreadNotificationCountUseCase: GetUnreadNotificationCountUseCase,
    private readonly getOneSignalIdentityTokenUseCase: GetOneSignalIdentityTokenUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Notifications retrieved successfully.')
  @ApiOperation({
    operationId: 'notificationsList',
    summary: "List the authenticated user's own notifications",
    description:
      "Paginated, ordered newest-first. Only the caller's own notifications (from the JWT, never a client-supplied userId). Optional unread=true filter.",
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications retrieved',
    type: NotificationListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid page/limit/unread', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  async list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<NotificationListResponseDto> {
    const result = await this.listNotificationsUseCase.execute({
      actor,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      unreadOnly: query.unread ?? false,
    });
    return this.toListResponse(result);
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Unread notification count retrieved successfully.')
  @ApiOperation({
    operationId: 'notificationsUnreadCount',
    summary: "Get the authenticated user's unread notification count",
    description: "A single count for a badge/indicator - the caller's own notifications only.",
  })
  @ApiResponse({ status: 200, description: 'Unread count retrieved', type: UnreadCountResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  async unreadCount(@CurrentActor() actor: AuthenticatedActor): Promise<UnreadCountResponseDto> {
    const result = await this.getUnreadNotificationCountUseCase.execute({ actor });
    return { count: result.count };
  }

  @Get('identity-token')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OneSignal identity token issued.')
  @ApiOperation({
    operationId: 'notificationsOneSignalIdentityToken',
    summary: 'Get a fresh OneSignal Identity-Verification JWT for the caller',
    description:
      "ADR-025 delivery mechanism (on-demand/refresh path). Returns a short-lived ES256 JWT proving ownership of external_id = the caller's User.id, for OneSignal.login()/updateUserJwt(). Call on app-open and whenever the SDK fires its JWT-invalidation listener. token is null when Identity Verification is not configured in this environment. Never returns any Tavola session token or the signing key.",
  })
  @ApiResponse({
    status: 200,
    description: 'Identity token issued (token may be null if unconfigured)',
    type: OneSignalIdentityTokenResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  identityToken(@CurrentActor() actor: AuthenticatedActor): OneSignalIdentityTokenResponseDto {
    const result = this.getOneSignalIdentityTokenUseCase.execute({ actor });
    return { token: result.token, expiresInSeconds: result.expiresInSeconds };
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Notification marked read.')
  @ApiOperation({
    operationId: 'notificationsMarkRead',
    summary: 'Mark one notification read',
    description:
      'Idempotent: marking an already-read notification succeeds. A non-owned or nonexistent id returns 404 (IDOR-safe, matching every other owned-resource route).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked read',
    type: NotificationResponseDto,
  })
  @ApiErrorResponse(400, 'id is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Notification not found', ['NOT_FOUND'])
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<NotificationResponseDto> {
    const result = await this.markNotificationReadUseCase.execute({ actor, notificationId: id });
    return this.toResponse(result);
  }

  @Patch('read-all')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('All notifications marked read.')
  @ApiOperation({
    operationId: 'notificationsMarkAllRead',
    summary: "Mark all of the authenticated user's unread notifications read",
  })
  @ApiResponse({ status: 200, description: 'All notifications marked read' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  async markAllRead(@CurrentActor() actor: AuthenticatedActor): Promise<Record<string, never>> {
    await this.markAllNotificationsReadUseCase.execute({ actor });
    return {};
  }

  private toResponse(result: NotificationResult): NotificationResponseDto {
    return {
      id: result.id,
      type: result.type,
      title: result.title,
      body: result.body,
      data: result.data,
      read: result.read,
      readAt: result.readAt ? result.readAt.toISOString() : null,
      createdAt: result.createdAt.toISOString(),
    };
  }

  private toListResponse(result: NotificationListResult): NotificationListResponseDto {
    return {
      items: result.items.map((item) => this.toResponse(item)),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }
}
