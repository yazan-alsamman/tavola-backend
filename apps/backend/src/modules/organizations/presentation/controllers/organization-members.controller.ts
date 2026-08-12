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
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '../../domain/enums/organization.enums';
import { ListOrganizationMembersUseCase } from '../../application/use-cases/list-organization-members.use-case';
import { ChangeOrganizationMemberRoleUseCase } from '../../application/use-cases/change-organization-member-role.use-case';
import { RemoveOrganizationMemberUseCase } from '../../application/use-cases/remove-organization-member.use-case';
import { SelfServiceTransferOrganizationOwnershipUseCase } from '../../application/use-cases/self-service-transfer-organization-ownership.use-case';
import { ChangeOrganizationMemberRoleRequestDto } from '../dto/change-organization-member-role.request.dto';
import {
  OrganizationMemberListResponseDto,
  OrganizationMemberResponseDto,
} from '../dto/organization-member.response.dto';
import { OwnershipTransferResponseDto } from '../dto/platform-admin-organization.response.dto';
import { toOwnershipTransferResponse } from './platform-admin-organization-response.mapper';

function toMemberResponse(result: {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  invitedAt: Date | null;
  joinedAt: Date | null;
}): OrganizationMemberResponseDto {
  return {
    id: result.id,
    organizationId: result.organizationId,
    userId: result.userId,
    role: result.role,
    status: result.status,
    invitedAt: result.invitedAt ? result.invitedAt.toISOString() : null,
    joinedAt: result.joinedAt ? result.joinedAt.toISOString() : null,
  };
}

/**
 * Phase 19.7 — Organization self-service member management (ADR-034 §7,
 * "Owner-initiated role-change/remove/transfer, an
 * `OrganizationMemberGuard`/`@RequireOrgRole`-gated controller surface" -
 * previously deferred, explicitly authorized this session). Distinct from
 * `/platform-admin/organizations/:id/...` (PlatformAdmin, internal back
 * office) - this is the Organization's own Owner/Admin managing their own
 * membership. No `:organizationId` path param anywhere, matching every
 * other `OrganizationMember`-scoped route in this codebase
 * (`OrganizationSubscriptionController`'s own precedent) - the acting
 * Organization is always the caller's own, resolved from the JWT.
 *
 * Owner Invite (Phase 19.8, ADR-036) is implemented separately, on
 * `OrganizationInvitationsController`/`OrganizationInvitationAcceptanceController`
 * - `OrganizationMember.userId` remains required/non-nullable, untouched by
 * that phase (Option B: a dedicated `OrganizationInvitation` entity, not a
 * nullable `userId`/`Invited -> Active` transition on this entity).
 */
@ApiTags('Organizations - Members')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'organizations/members', version: '1' })
export class OrganizationMembersController {
  constructor(
    private readonly listOrganizationMembersUseCase: ListOrganizationMembersUseCase,
    private readonly changeOrganizationMemberRoleUseCase: ChangeOrganizationMemberRoleUseCase,
    private readonly removeOrganizationMemberUseCase: RemoveOrganizationMemberUseCase,
    private readonly selfServiceTransferOwnershipUseCase: SelfServiceTransferOrganizationOwnershipUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization members retrieved successfully.')
  @ApiOperation({
    operationId: 'organizationsListMembers',
    summary: "List the caller's own Organization's members (Owner/Admin only)",
  })
  @ApiResponse({
    status: 200,
    description: 'Members retrieved',
    type: OrganizationMemberListResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  async list(@Query() query: PaginationQueryDto): Promise<OrganizationMemberListResponseDto> {
    const result = await this.listOrganizationMembersUseCase.execute({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toMemberResponse),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Patch(':memberId/role')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization member role changed successfully.')
  @ApiOperation({
    operationId: 'organizationsChangeMemberRole',
    summary: "Change a member's role within the caller's own Organization (Owner/Admin only)",
    description:
      'Promoting a member TO Owner, or changing the current Owner AWAY from Owner, is rejected (409) - both must go through Transfer Ownership instead.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Role changed',
    type: OrganizationMemberResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(
    403,
    'Caller is not an Owner/Admin organization member, or the role change touches Owner (use Transfer Ownership instead)',
    ['FORBIDDEN'],
  )
  @ApiErrorResponse(404, 'Member not found in the caller’s own Organization', ['NOT_FOUND'])
  async changeRole(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: ChangeOrganizationMemberRoleRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OrganizationMemberResponseDto> {
    const result = await this.changeOrganizationMemberRoleUseCase.execute({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      targetMemberId: memberId,
      newRole: body.role,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMemberResponse(result);
  }

  @Delete(':memberId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization member removed successfully.')
  @ApiOperation({
    operationId: 'organizationsRemoveMember',
    summary: "Remove a member from the caller's own Organization (Owner/Admin only)",
    description:
      'Status-flip to Removed (OrganizationMember has no deletedAt column). Removing the sole Active Owner is rejected (403) - transfer ownership first.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Member removed',
    type: OrganizationMemberResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(
    403,
    'Caller is not an Owner/Admin organization member, or target is the sole Owner',
    ['FORBIDDEN'],
  )
  @ApiErrorResponse(404, 'Member not found in the caller’s own Organization', ['NOT_FOUND'])
  async remove(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OrganizationMemberResponseDto> {
    const result = await this.removeOrganizationMemberUseCase.execute({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      targetMemberId: memberId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMemberResponse(result);
  }

  @Post(':memberId/transfer-ownership')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization ownership transferred successfully.')
  @ApiOperation({
    operationId: 'organizationsTransferOwnership',
    summary:
      "Transfer the caller's own Organization ownership to another Active member (Owner only)",
    description:
      'Self-service counterpart to the PlatformAdmin emergency transfer (ADR-034 §6) - reuses OrganizationMembershipPolicy.transferOwnership verbatim. Only the current Owner may call this.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid', description: 'Target member to become Owner' })
  @ApiResponse({
    status: 200,
    description: 'Ownership transferred',
    type: OwnershipTransferResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not the current Owner', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Target member not found in the caller’s own Organization', ['NOT_FOUND'])
  @ApiErrorResponse(
    409,
    'Target member is already Owner, not Active, or ownership changed concurrently',
    ['CONFLICT'],
  )
  async transferOwnership(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OwnershipTransferResponseDto> {
    const result = await this.selfServiceTransferOwnershipUseCase.execute({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      targetMemberId: memberId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toOwnershipTransferResponse(result);
  }
}
