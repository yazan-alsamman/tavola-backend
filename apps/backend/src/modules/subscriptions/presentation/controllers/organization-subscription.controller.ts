import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
import { GetOrganizationSubscriptionUseCase } from '../../application/use-cases/get-organization-subscription.use-case';
import { GetOrganizationSubscriptionUsageUseCase } from '../../application/use-cases/get-organization-subscription-usage.use-case';
import { SubscriptionResponseDto } from '../dto/subscription.response.dto';
import { SubscriptionUsageResponseDto } from '../dto/subscription-usage.response.dto';
import {
  toSubscriptionResponse,
  toSubscriptionUsageResponse,
} from './subscription-response.mapper';

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027).
 * Organization Owner/Admin read-only (D23) - `OrganizationMemberGuard` +
 * `@RequireOrgRole(Owner, Admin)`, the same gate `RestaurantsController`'s
 * Gallery/Settings endpoints already use. No Employee visibility, no
 * Customer visibility (D23/D24) - neither actor type can reach this
 * controller at all (no permission slug exists for it, no Customer guard
 * chain applies).
 *
 * Deliberately no `:id`/`organizationId` path parameter - an
 * implementation-time route-naming reconciliation (task-authorized:
 * "if exact route naming conflicts with an already-frozen repository
 * convention, use the existing convention and document the
 * reconciliation"). Every other `OrganizationMember`-scoped route in this
 * codebase resolves the acting Organization implicitly from the JWT
 * (`TenantContextInterceptor`), never from a client-suppliable URL segment
 * (TENANCY.md §"HTTP Requests": "never from a request body or query
 * parameter - the client never gets to declare its own tenant"). Taking an
 * explicit `:id` here would be the only OrganizationMember-scoped route in
 * the entire codebase that does so, and would need its own IDOR check
 * (actor.organizationId === params.id) that every other route avoids by
 * construction. The PlatformAdmin routes for the same resource
 * (`PlatformAdminSubscriptionsController`) correctly keep an explicit `:id`
 * - a PlatformAdmin actor has no "own organization" to imply.
 */
@ApiTags('Organizations - Subscription')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'organizations/subscription', version: '1' })
export class OrganizationSubscriptionController {
  constructor(
    private readonly getOrganizationSubscriptionUseCase: GetOrganizationSubscriptionUseCase,
    private readonly getOrganizationSubscriptionUsageUseCase: GetOrganizationSubscriptionUsageUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription retrieved successfully.')
  @ApiOperation({
    operationId: 'organizationsGetSubscription',
    summary: "Get the caller's own Organization subscription (Owner/Admin only)",
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription retrieved',
    type: SubscriptionResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'No subscription exists for this Organization', ['NOT_FOUND'])
  async getSubscription(
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.getOrganizationSubscriptionUseCase.execute(actor.organizationId);
    return toSubscriptionResponse(result);
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subscription usage retrieved successfully.')
  @ApiOperation({
    operationId: 'organizationsGetSubscriptionUsage',
    summary:
      "Get the caller's own Organization's current usage against its plan limits (Owner/Admin only)",
    description:
      'maxBranchesPerRestaurant/maxEmployeesPerRestaurant are per-Restaurant - the per-restaurant breakdown never sums another restaurant into the same total.',
  })
  @ApiResponse({ status: 200, description: 'Usage retrieved', type: SubscriptionUsageResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'No subscription exists for this Organization', ['NOT_FOUND'])
  async getUsage(
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<SubscriptionUsageResponseDto> {
    const result = await this.getOrganizationSubscriptionUsageUseCase.execute(actor.organizationId);
    return toSubscriptionUsageResponse(result);
  }
}
