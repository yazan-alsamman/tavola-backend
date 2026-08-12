import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
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
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { SendRestaurantOwnerNotificationBroadcastUseCase } from '../../application/use-cases/send-restaurant-owner-notification-broadcast.use-case';
import { SendNotificationBroadcastRequestDto } from '../dto/send-notification-broadcast.request.dto';
import { NotificationBroadcastResponseDto } from '../dto/notification-broadcast.response.dto';

/**
 * Phase 19.9 (ADR-037) — internal notification system, Restaurant Dashboard
 * authoring surface. Same `restaurants/:restaurantId/*` + `OrganizationMemberGuard`
 * + `@RequireOrgRole(Owner, Admin)` shape as `OffersController` -
 * `restaurantId` proves the caller controls THIS restaurant (a cross-org id
 * collapses to 404 via the tenant-scoped `RestaurantRepository` lookup, the
 * same IDOR-safe convention every other restaurant-scoped route already
 * uses) but is never used to narrow the (global) broadcast audience -
 * ADR-037 Decision #4, an explicit product decision.
 */
@ApiTags('Restaurant Dashboard - Notifications')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/notifications', version: '1' })
export class RestaurantNotificationsController {
  constructor(
    private readonly sendRestaurantOwnerNotificationBroadcastUseCase: SendRestaurantOwnerNotificationBroadcastUseCase,
  ) {}

  @Post('broadcast')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Notification broadcast queued successfully.')
  @ApiOperation({
    operationId: 'restaurantBroadcastNotification',
    summary:
      'Broadcast an in-app notification to all eligible Customers (Restaurant Owner/Admin only)',
    description:
      "Processed asynchronously via BullMQ, in batches - 202 Accepted means the broadcast was queued, not that delivery has completed. Audience is platform-wide (every active Customer account with marketingOptIn enabled), not limited to this restaurant's own customers - restaurantId only proves the caller controls this restaurant and is recorded for audit.",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 202,
    description: 'Broadcast queued',
    type: NotificationBroadcastResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async broadcast(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() body: SendNotificationBroadcastRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<NotificationBroadcastResponseDto> {
    const result = await this.sendRestaurantOwnerNotificationBroadcastUseCase.execute({
      ownerId: actor.userId,
      organizationId: actor.organizationId,
      restaurantId,
      title: body.title,
      body: body.body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return { broadcastId: result.broadcastId, totalRecipients: result.totalRecipients };
  }
}
