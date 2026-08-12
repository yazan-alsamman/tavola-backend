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
import { IssueOrganizationInvitationUseCase } from '../../application/use-cases/issue-organization-invitation.use-case';
import { ListOrganizationInvitationsUseCase } from '../../application/use-cases/list-organization-invitations.use-case';
import { RevokeOrganizationInvitationUseCase } from '../../application/use-cases/revoke-organization-invitation.use-case';
import { OrganizationInvitationResult } from '../../application/dto/organization-invitation.dto';
import { IssueOrganizationInvitationRequestDto } from '../dto/issue-organization-invitation.request.dto';
import {
  OrganizationInvitationListResponseDto,
  OrganizationInvitationResponseDto,
} from '../dto/organization-invitation.response.dto';

function toInvitationResponse(
  result: OrganizationInvitationResult,
): OrganizationInvitationResponseDto {
  return {
    id: result.id,
    organizationId: result.organizationId,
    email: result.email,
    role: result.role,
    status: result.status,
    invitedByUserId: result.invitedByUserId,
    expiresAt: result.expiresAt.toISOString(),
    acceptedAt: result.acceptedAt ? result.acceptedAt.toISOString() : null,
    createdAt: result.createdAt.toISOString(),
  };
}

/**
 * Phase 19.8 (Owner Invite, ADR-036, Option B - explicit acceptance-required
 * invitation lifecycle). Owner/Admin issue/list/revoke, same
 * `OrganizationMemberGuard`/`@RequireOrgRole`/no-`:organizationId`-path-param
 * conventions `OrganizationMembersController` already established. The
 * public accept endpoint lives on a separate, unguarded controller -
 * `OrganizationInvitationAcceptanceController` - since acceptance must
 * remain reachable by an anonymous, not-yet-registered invitee (Section 8).
 */
@ApiTags('Organizations - Invitations')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'organizations/invitations', version: '1' })
export class OrganizationInvitationsController {
  constructor(
    private readonly issueInvitationUseCase: IssueOrganizationInvitationUseCase,
    private readonly listInvitationsUseCase: ListOrganizationInvitationsUseCase,
    private readonly revokeInvitationUseCase: RevokeOrganizationInvitationUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Invitation issued successfully.')
  @ApiOperation({
    operationId: 'organizationsIssueInvitation',
    summary: "Invite a new member into the caller's own Organization (Owner/Admin only)",
    description:
      'Owner cannot be granted by invitation - use Transfer Ownership instead. Re-inviting the same email revokes any still-pending invitation first, then issues a new one.',
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation issued',
    type: OrganizationInvitationResponseDto,
  })
  @ApiErrorResponse(400, 'Role is Owner, or the email is invalid', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(409, 'Target email already belongs to an active member of the Organization', [
    'CONFLICT',
  ])
  async issue(
    @Body() body: IssueOrganizationInvitationRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OrganizationInvitationResponseDto> {
    const result = await this.issueInvitationUseCase.execute({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      email: body.email,
      role: body.role,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toInvitationResponse(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invitations retrieved successfully.')
  @ApiOperation({
    operationId: 'organizationsListInvitations',
    summary: "List the caller's own Organization's invitations (Owner/Admin only)",
  })
  @ApiResponse({
    status: 200,
    description: 'Invitations retrieved',
    type: OrganizationInvitationListResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<OrganizationInvitationListResponseDto> {
    const result = await this.listInvitationsUseCase.execute({
      organizationId: actor.organizationId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toInvitationResponse),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Delete(':invitationId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invitation revoked successfully.')
  @ApiOperation({
    operationId: 'organizationsRevokeInvitation',
    summary: "Revoke a pending invitation in the caller's own Organization (Owner/Admin only)",
    description: 'Immediately invalidates the invitation token even though it has not expired.',
  })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Invitation revoked',
    type: OrganizationInvitationResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Invitation not found in the caller’s own Organization', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Invitation is no longer pending', ['CONFLICT'])
  async revoke(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OrganizationInvitationResponseDto> {
    const result = await this.revokeInvitationUseCase.execute({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      invitationId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toInvitationResponse(result);
  }
}
