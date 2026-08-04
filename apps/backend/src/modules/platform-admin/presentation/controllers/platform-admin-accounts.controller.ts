import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '../guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '../decorators/require-platform-admin-role.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminActor } from '../../application/dto/platform-admin-actor.dto';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { CreatePlatformAdminUseCase } from '../../application/use-cases/create-platform-admin.use-case';
import { UpdatePlatformAdminRoleUseCase } from '../../application/use-cases/update-platform-admin-role.use-case';
import { DeactivatePlatformAdminUseCase } from '../../application/use-cases/deactivate-platform-admin.use-case';
import { ReactivatePlatformAdminUseCase } from '../../application/use-cases/reactivate-platform-admin.use-case';
import { ListPlatformAdminsUseCase } from '../../application/use-cases/list-platform-admins.use-case';
import { GetPlatformAdminUseCase } from '../../application/use-cases/get-platform-admin.use-case';
import { CreatePlatformAdminRequestDto } from '../dto/create-platform-admin.request.dto';
import { UpdatePlatformAdminRoleRequestDto } from '../dto/update-platform-admin-role.request.dto';
import {
  PlatformAdminAccountListResponseDto,
  PlatformAdminAccountResponseDto,
} from '../dto/platform-admin-account.response.dto';
import { toPlatformAdminAccountResponse } from './platform-admin-account.mapper';

/**
 * ADR-034 §10-12 (Phase 19.1). Reads (`List`/`Get`) are available to both
 * Platform tiers; every mutation is `PlatformAdmin`-only, per §11's
 * "PlatformSupport is read-only, no mutation authority."
 */
@ApiTags('Platform Admin - Accounts')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/admins', version: '1' })
export class PlatformAdminAccountsController {
  constructor(
    private readonly createPlatformAdminUseCase: CreatePlatformAdminUseCase,
    private readonly updatePlatformAdminRoleUseCase: UpdatePlatformAdminRoleUseCase,
    private readonly deactivatePlatformAdminUseCase: DeactivatePlatformAdminUseCase,
    private readonly reactivatePlatformAdminUseCase: ReactivatePlatformAdminUseCase,
    private readonly listPlatformAdminsUseCase: ListPlatformAdminsUseCase,
    private readonly getPlatformAdminUseCase: GetPlatformAdminUseCase,
  ) {}

  @Post()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Platform Admin account created successfully.')
  @ApiOperation({
    operationId: 'platformAdminCreateAccount',
    summary: 'Create a Platform Admin or Platform Support account (PlatformAdmin only)',
    description:
      "Mirrors Restaurant Owner provisioning's trust model: the supplied password is the final password, immediately Active/emailVerified, no OTP step. Credential communication to the new admin is out-of-band.",
  })
  @ApiResponse({
    status: 201,
    description: 'Account created',
    type: PlatformAdminAccountResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin (PlatformSupport cannot mutate)', [
    'FORBIDDEN',
  ])
  @ApiErrorResponse(409, 'Email already exists', ['CONFLICT'])
  async create(
    @Body() body: CreatePlatformAdminRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
  ): Promise<PlatformAdminAccountResponseDto> {
    const result = await this.createPlatformAdminUseCase.execute({
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
      actorId: actor.userId,
    });
    return toPlatformAdminAccountResponse(result);
  }

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Platform Admin accounts retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListAccounts',
    summary: 'List Platform Admin/Support accounts (PlatformAdmin or PlatformSupport)',
  })
  @ApiResponse({
    status: 200,
    description: 'Accounts retrieved',
    type: PlatformAdminAccountListResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async list(@Query() query: PaginationQueryDto): Promise<PlatformAdminAccountListResponseDto> {
    const result = await this.listPlatformAdminsUseCase.execute({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toPlatformAdminAccountResponse),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Get(':id')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Platform Admin account retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetAccount',
    summary: 'Get a Platform Admin/Support account by id (PlatformAdmin or PlatformSupport)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Account retrieved',
    type: PlatformAdminAccountResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Platform Admin not found', ['NOT_FOUND'])
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformAdminAccountResponseDto> {
    const result = await this.getPlatformAdminUseCase.execute({ platformAdminId: id });
    return toPlatformAdminAccountResponse(result);
  }

  @Patch(':id')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Platform Admin role updated successfully.')
  @ApiOperation({
    operationId: 'platformAdminUpdateAccountRole',
    summary: "Change a Platform Admin account's role (PlatformAdmin only)",
    description: '`role` is the only mutable field on this resource - no name/email lives here.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role updated', type: PlatformAdminAccountResponseDto })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Platform Admin not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Cannot modify your own account', ['CONFLICT'])
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlatformAdminRoleRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
  ): Promise<PlatformAdminAccountResponseDto> {
    const result = await this.updatePlatformAdminRoleUseCase.execute({
      platformAdminId: id,
      role: body.role,
      actorId: actor.userId,
    });
    return toPlatformAdminAccountResponse(result);
  }

  @Post(':id/deactivate')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Platform Admin account deactivated successfully.')
  @ApiOperation({
    operationId: 'platformAdminDeactivateAccount',
    summary: 'Deactivate (revoke) a Platform Admin account (PlatformAdmin only)',
    description:
      'Sets `revokedAt` - terminal until Reactivate. No hard-delete endpoint exists (no precedent anywhere in this codebase for an audit-relevant entity); this is also the "Delete Platform Admin" capability.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Platform Admin not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Cannot deactivate your own account', ['CONFLICT'])
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
  ): Promise<void> {
    await this.deactivatePlatformAdminUseCase.execute({
      platformAdminId: id,
      actorId: actor.userId,
    });
  }

  @Post(':id/reactivate')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Platform Admin account reactivated successfully.')
  @ApiOperation({
    operationId: 'platformAdminReactivateAccount',
    summary: 'Reactivate a previously deactivated Platform Admin account (PlatformAdmin only)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Platform Admin not found', ['NOT_FOUND'])
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
  ): Promise<void> {
    await this.reactivatePlatformAdminUseCase.execute({
      platformAdminId: id,
      actorId: actor.userId,
    });
  }
}
