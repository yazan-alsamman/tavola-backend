import {
  Body,
  Controller,
  Get,
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
import { PlatformAdminGuard } from '@modules/platform-admin/presentation/guards/platform-admin.guard';
import { CurrentPlatformAdmin } from '@modules/platform-admin/presentation/decorators/current-platform-admin.decorator';
import { PlatformAdminActor } from '@modules/platform-admin/application/dto/platform-admin-actor.dto';
import { ListSubscriptionPlansUseCase } from '../../application/use-cases/list-subscription-plans.use-case';
import { AssignSubscriptionUseCase } from '../../application/use-cases/assign-subscription.use-case';
import { SuspendSubscriptionUseCase } from '../../application/use-cases/suspend-subscription.use-case';
import { ReactivateSubscriptionUseCase } from '../../application/use-cases/reactivate-subscription.use-case';
import { CancelSubscriptionUseCase } from '../../application/use-cases/cancel-subscription.use-case';
import { GetOrganizationSubscriptionUseCase } from '../../application/use-cases/get-organization-subscription.use-case';
import { AssignSubscriptionRequestDto } from '../dto/assign-subscription.request.dto';
import { SubscriptionResponseDto } from '../dto/subscription.response.dto';
import { SubscriptionPlanListResponseDto } from '../dto/subscription-plan-list.response.dto';
import { toSubscriptionPlanResponse, toSubscriptionResponse } from './subscription-response.mapper';

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027).
 * PlatformAdmin-only (D9) - every route requires `PlatformAdminGuard`
 * alone, never `JwtAuthGuard` (see `PlatformAdminController`'s own doc
 * comment for why the two guards are never combined). No customer-facing
 * purchase/checkout endpoint exists anywhere in this controller (D22) - the
 * write surface here is exhaustively: assign/change plan, suspend,
 * reactivate, cancel. No `POST`/`PATCH`/`DELETE /platform-admin/plans` -
 * plans are seed-managed (D2), read-only here.
 */
@ApiTags('Platform Admin - Subscriptions')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin', version: '1' })
export class PlatformAdminSubscriptionsController {
  constructor(
    private readonly listSubscriptionPlansUseCase: ListSubscriptionPlansUseCase,
    private readonly assignSubscriptionUseCase: AssignSubscriptionUseCase,
    private readonly suspendSubscriptionUseCase: SuspendSubscriptionUseCase,
    private readonly reactivateSubscriptionUseCase: ReactivateSubscriptionUseCase,
    private readonly cancelSubscriptionUseCase: CancelSubscriptionUseCase,
    private readonly getOrganizationSubscriptionUseCase: GetOrganizationSubscriptionUseCase,
  ) {}

  @Get('plans')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription plans retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListSubscriptionPlans',
    summary: 'List the subscription plan catalog (Platform Admin only)',
    description:
      'Read-only - plans are seed-managed (D2), no runtime write API exists in Phase 12.',
  })
  @ApiResponse({
    status: 200,
    description: 'Plans retrieved',
    type: SubscriptionPlanListResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async listPlans(): Promise<SubscriptionPlanListResponseDto> {
    const results = await this.listSubscriptionPlansUseCase.execute();
    return { items: results.map(toSubscriptionPlanResponse) };
  }

  @Get('organizations/:id/subscription')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetOrganizationSubscription',
    summary: "Inspect an Organization's current subscription (Platform Admin only)",
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Subscription retrieved',
    type: SubscriptionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'No subscription exists for this Organization', ['NOT_FOUND'])
  async getSubscription(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.getOrganizationSubscriptionUseCase.execute(organizationId);
    return toSubscriptionResponse(result);
  }

  @Post('organizations/:id/subscription')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription assigned successfully.')
  @ApiOperation({
    operationId: 'platformAdminAssignSubscription',
    summary: 'Assign or change an Organization subscription plan (Platform Admin only)',
    description:
      'Serves both initial assignment (no Subscription yet, or resuming a Cancelled/Expired one) and an immediate plan change on an Active Subscription, branching on the current state - no separate "change plan" endpoint. Downgrade is rejected outright (403) if current usage exceeds the target plan (D13). Suspended subscriptions must be Reactivated first.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Subscription assigned/changed',
    type: SubscriptionResponseDto,
  })
  @ApiErrorResponse(
    403,
    'Caller is not an active Platform Admin, or the plan change would exceed a limit',
    ['FORBIDDEN', 'SUBSCRIPTION_LIMIT_EXCEEDED'],
  )
  @ApiErrorResponse(404, 'Organization or plan not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Plan is archived, or subscription is Suspended (reactivate first)', [
    'CONFLICT',
  ])
  async assignSubscription(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() body: AssignSubscriptionRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.assignSubscriptionUseCase.execute({
      actor,
      organizationId,
      planId: body.planId,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toSubscriptionResponse(result);
  }

  @Post('organizations/:id/subscription/suspend')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription suspended successfully.')
  @ApiOperation({
    operationId: 'platformAdminSuspendSubscription',
    summary: 'Suspend an Organization subscription (Platform Admin only)',
    description:
      'Active -> Suspended only. Blocks new resource creation; never mutates Restaurant state or gates existing features (ADR-027 §9).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Subscription suspended',
    type: SubscriptionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'No subscription exists for this Organization', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Subscription is not currently Active', ['CONFLICT'])
  async suspend(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.suspendSubscriptionUseCase.execute({
      actor,
      organizationId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toSubscriptionResponse(result);
  }

  @Post('organizations/:id/subscription/reactivate')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription reactivated successfully.')
  @ApiOperation({
    operationId: 'platformAdminReactivateSubscription',
    summary: 'Reactivate a Suspended Organization subscription (Platform Admin only)',
    description: 'Suspended -> Active only - the sole path back to Active from Suspended (D8).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Subscription reactivated',
    type: SubscriptionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'No subscription exists for this Organization', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Subscription is not currently Suspended', ['CONFLICT'])
  async reactivate(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.reactivateSubscriptionUseCase.execute({
      actor,
      organizationId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toSubscriptionResponse(result);
  }

  @Post('organizations/:id/subscription/cancel')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription cancelled successfully.')
  @ApiOperation({
    operationId: 'platformAdminCancelSubscription',
    summary: 'Cancel an Organization subscription (Platform Admin only)',
    description:
      'Active -> Cancelled only. Terminal - not automatically reactivated; resuming requires a fresh plan assignment (D8).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Subscription cancelled',
    type: SubscriptionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'No subscription exists for this Organization', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Subscription is not currently Active', ['CONFLICT'])
  async cancel(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.cancelSubscriptionUseCase.execute({
      actor,
      organizationId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toSubscriptionResponse(result);
  }
}
