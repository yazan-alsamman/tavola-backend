import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { PlatformAdminGuard } from '@modules/platform-admin/presentation/guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '@modules/platform-admin/presentation/guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '@modules/platform-admin/presentation/decorators/require-platform-admin-role.decorator';
import { CurrentPlatformAdmin } from '@modules/platform-admin/presentation/decorators/current-platform-admin.decorator';
import { PlatformAdminActor } from '@modules/platform-admin/application/dto/platform-admin-actor.dto';
import { PlatformAdminRole } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { SendNotificationToCustomerUseCase } from '../../application/use-cases/send-notification-to-customer.use-case';
import { SendPlatformAdminNotificationBroadcastUseCase } from '../../application/use-cases/send-platform-admin-notification-broadcast.use-case';
import { SendNotificationToCustomerRequestDto } from '../dto/send-notification-to-customer.request.dto';
import { SendNotificationBroadcastRequestDto } from '../dto/send-notification-broadcast.request.dto';
import { NotificationSendResponseDto } from '../dto/notification-send.response.dto';
import { NotificationBroadcastResponseDto } from '../dto/notification-broadcast.response.dto';
import { PlatformAdminListNotificationBroadcastsUseCase } from '../../application/use-cases/platform-admin-list-notification-broadcasts.use-case';
import {
  ListNotificationBroadcastsQueryDto,
  NotificationBroadcastHistoryListResponseDto,
} from '../dto/notification-broadcast-history.response.dto';

/**
 * Phase 19.9 (ADR-037) — internal notification system, Platform Admin
 * authoring surface. Route family `/platform-admin/notifications*`, mirroring
 * `PlatformAdminAcquisitionsController`'s exact shape
 * (API_GUIDELINES.md's Platform Back Office Route Ownership table). Both
 * routes are PlatformAdmin-only mutations - `PlatformSupport` (the read-only
 * tier, ADR-034 §11) has no mutation authority here, same as
 * Reverse/ManuallyRecord on the Acquisitions controller.
 *
 * NO FIREBASE, NO ONESIGNAL, NO EXTERNAL PUSH PROVIDER - this is the internal
 * notification system only (durable PostgreSQL row + Socket.IO realtime
 * hint), never OneSignal's existing Push track.
 */
@ApiTags('Platform Admin - Notifications')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/notifications', version: '1' })
export class PlatformAdminNotificationsController {
  constructor(
    private readonly sendNotificationToCustomerUseCase: SendNotificationToCustomerUseCase,
    private readonly sendPlatformAdminNotificationBroadcastUseCase: SendPlatformAdminNotificationBroadcastUseCase,
    private readonly listNotificationBroadcastsUseCase: PlatformAdminListNotificationBroadcastsUseCase,
  ) {}

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Notification broadcasts retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListNotificationBroadcasts',
    summary: 'Notification broadcast history with real delivery state (both Platform tiers)',
    description:
      'The counterpart to POST /platform-admin/notifications/broadcast, which returns 202 Accepted and therefore cannot report an outcome - delivery happens asynchronously via BullMQ. Every field here is persisted NotificationBroadcast state written by the fan-out processor: status (Pending/Processing/Completed/Failed), processed/succeeded/failed counters, the queue-time audience snapshot, and createdAt/updatedAt. Nothing is synthesized at read time. Newest first, paginated, optionally filtered by status and senderType; both Platform Admin and Restaurant Owner broadcasts are included unless senderType narrows it. Read-only, so PlatformSupport may call it even though authoring a broadcast is PlatformAdmin-only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Broadcast history retrieved',
    type: NotificationBroadcastHistoryListResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Missing, malformed, or expired access token', ['UNAUTHORIZED'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async listBroadcasts(
    @Query() query: ListNotificationBroadcastsQueryDto,
  ): Promise<NotificationBroadcastHistoryListResponseDto> {
    const result = await this.listNotificationBroadcastsUseCase.execute({
      status: query.status,
      senderType: query.senderType,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });

    return {
      items: result.items.map((row) => ({
        id: row.id,
        senderType: row.senderType,
        senderId: row.senderId,
        organizationId: row.organizationId,
        title: row.title,
        body: row.body,
        totalRecipients: row.totalRecipients,
        processedCount: row.processedCount,
        succeededCount: row.succeededCount,
        failedCount: row.failedCount,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Post()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Notification sent to customer successfully.')
  @ApiOperation({
    operationId: 'platformAdminSendNotificationToCustomer',
    summary: 'Send an in-app notification to one specific Customer (PlatformAdmin only)',
    description:
      'targetUserId must resolve to an eligible Customer - a PlatformAdmin, OrganizationMember, Employee, or nonexistent/inactive/deleted account id collapses to 404 (IDOR-safe, never distinguishes why).',
  })
  @ApiResponse({
    status: 201,
    description: 'Notification created',
    type: NotificationSendResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'targetUserId is not an eligible Customer', ['NOT_FOUND'])
  async sendToCustomer(
    @Body() body: SendNotificationToCustomerRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<NotificationSendResponseDto> {
    const result = await this.sendNotificationToCustomerUseCase.execute({
      adminId: actor.userId,
      targetUserId: body.targetUserId,
      title: body.title,
      body: body.body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return { notificationId: result.notificationId };
  }

  @Post('broadcast')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Notification broadcast queued successfully.')
  @ApiOperation({
    operationId: 'platformAdminBroadcastNotification',
    summary: 'Broadcast an in-app notification to all eligible Customers (PlatformAdmin only)',
    description:
      'Processed asynchronously via BullMQ, in batches - 202 Accepted means the broadcast was queued, not that delivery has completed. Audience: every active Customer account with marketingOptIn enabled, platform-wide.',
  })
  @ApiResponse({
    status: 202,
    description: 'Broadcast queued',
    type: NotificationBroadcastResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  async broadcast(
    @Body() body: SendNotificationBroadcastRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<NotificationBroadcastResponseDto> {
    const result = await this.sendPlatformAdminNotificationBroadcastUseCase.execute({
      adminId: actor.userId,
      title: body.title,
      body: body.body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return { broadcastId: result.broadcastId, totalRecipients: result.totalRecipients };
  }
}
