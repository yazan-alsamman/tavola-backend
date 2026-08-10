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
import { PlatformAdminGuard } from '@modules/platform-admin/presentation/guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '@modules/platform-admin/presentation/guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '@modules/platform-admin/presentation/decorators/require-platform-admin-role.decorator';
import { CurrentPlatformAdmin } from '@modules/platform-admin/presentation/decorators/current-platform-admin.decorator';
import { PlatformAdminActor } from '@modules/platform-admin/application/dto/platform-admin-actor.dto';
import { PlatformAdminRole } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { PlatformAdminSuspendOrganizationUseCase } from '../../application/use-cases/platform-admin-suspend-organization.use-case';
import { PlatformAdminReactivateOrganizationUseCase } from '../../application/use-cases/platform-admin-reactivate-organization.use-case';
import { PlatformAdminDeleteOrganizationUseCase } from '../../application/use-cases/platform-admin-delete-organization.use-case';
import { PlatformAdminRestoreOrganizationUseCase } from '../../application/use-cases/platform-admin-restore-organization.use-case';
import { PlatformAdminTransferOrganizationOwnershipUseCase } from '../../application/use-cases/platform-admin-transfer-organization-ownership.use-case';
import { TransferOrganizationOwnershipRequestDto } from '../dto/transfer-organization-ownership.request.dto';
import {
  OwnershipTransferResponseDto,
  PlatformAdminOrganizationResponseDto,
} from '../dto/platform-admin-organization.response.dto';
import {
  toOwnershipTransferResponse,
  toPlatformAdminOrganizationResponse,
} from './platform-admin-organization-response.mapper';

/**
 * ADR-034 §4/§6, API_GUIDELINES.md's Platform Back Office Route Ownership
 * table: `/platform-admin/organizations/:id/{suspend,reactivate,delete,restore,transfer-ownership}`.
 * `:id` IS the organizationId directly (unlike Restaurants, no lookup step
 * needed) - pure Pattern 1. This is `OrganizationsModule`'s first real
 * controller/use-case layer. Delete/Restore added Phase 19.4, mirroring
 * Restaurant Delete/Restore's exact route/verb/authorization shape
 * (Phase 19.1).
 */
@ApiTags('Platform Admin - Organizations')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/organizations', version: '1' })
export class PlatformAdminOrganizationsController {
  constructor(
    private readonly suspendOrganizationUseCase: PlatformAdminSuspendOrganizationUseCase,
    private readonly reactivateOrganizationUseCase: PlatformAdminReactivateOrganizationUseCase,
    private readonly deleteOrganizationUseCase: PlatformAdminDeleteOrganizationUseCase,
    private readonly restoreOrganizationUseCase: PlatformAdminRestoreOrganizationUseCase,
    private readonly transferOwnershipUseCase: PlatformAdminTransferOrganizationOwnershipUseCase,
  ) {}

  @Post(':id/suspend')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization suspended successfully.')
  @ApiOperation({
    operationId: 'platformAdminSuspendOrganization',
    summary: 'Suspend an Organization (PlatformAdmin only)',
    description: 'Never cascades to Restaurant.status - no cascade, ever (ADR-034 §5).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Organization suspended',
    type: PlatformAdminOrganizationResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Organization not found', ['NOT_FOUND'])
  async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminOrganizationResponseDto> {
    const result = await this.suspendOrganizationUseCase.execute({
      organizationId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminOrganizationResponse(result);
  }

  @Post(':id/reactivate')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization reactivated successfully.')
  @ApiOperation({
    operationId: 'platformAdminReactivateOrganization',
    summary: 'Reactivate a suspended Organization (PlatformAdmin only)',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Organization reactivated',
    type: PlatformAdminOrganizationResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Organization not found', ['NOT_FOUND'])
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminOrganizationResponseDto> {
    const result = await this.reactivateOrganizationUseCase.execute({
      organizationId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminOrganizationResponse(result);
  }

  @Post(':id/delete')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization deleted successfully.')
  @ApiOperation({
    operationId: 'platformAdminDeleteOrganization',
    summary: 'Soft-delete an Organization (PlatformAdmin only)',
    description:
      'ADR-034 §4 - soft delete only (deletedAt), never a hard delete. Never cascades to Restaurant/Branch/Employee/Reservation data - no cascade, ever (§5). Works regardless of current Active/Suspended status; re-applies harmlessly if already deleted.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Organization deleted',
    type: PlatformAdminOrganizationResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Organization not found', ['NOT_FOUND'])
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminOrganizationResponseDto> {
    const result = await this.deleteOrganizationUseCase.execute({
      organizationId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminOrganizationResponse(result);
  }

  @Post(':id/restore')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization restored successfully.')
  @ApiOperation({
    operationId: 'platformAdminRestoreOrganization',
    summary: 'Restore a previously soft-deleted Organization (PlatformAdmin only)',
    description:
      'ADR-034 §4 - closes the same standing "no restore capability" gap ADR-034 §3 already closed for Restaurant. Only clears deletedAt - never touches status, so a Suspended-and-deleted Organization restores back to Suspended, not Active.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Organization restored',
    type: PlatformAdminOrganizationResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Organization not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Organization is not currently deleted', ['CONFLICT'])
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminOrganizationResponseDto> {
    const result = await this.restoreOrganizationUseCase.execute({
      organizationId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminOrganizationResponse(result);
  }

  @Post(':id/transfer-ownership')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization ownership transferred successfully.')
  @ApiOperation({
    operationId: 'platformAdminTransferOrganizationOwnership',
    summary:
      'Emergency-transfer Organization ownership to another Active member (PlatformAdmin only)',
    description:
      "Narrow, PlatformAdmin-only (ADR-034 §6) - finally resolves OwnershipTransferRequiredException's previously unsatisfiable precondition. Full self-service Organization management remains out of scope.",
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Organization id' })
  @ApiResponse({
    status: 200,
    description: 'Ownership transferred',
    type: OwnershipTransferResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Organization has no current Owner, or target user is not a member', [
    'NOT_FOUND',
  ])
  @ApiErrorResponse(409, 'Target member is already Owner, or not Active', ['CONFLICT'])
  async transferOwnership(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransferOrganizationOwnershipRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<OwnershipTransferResponseDto> {
    const result = await this.transferOwnershipUseCase.execute({
      organizationId: id,
      newOwnerUserId: body.newOwnerUserId,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toOwnershipTransferResponse(result);
  }
}
