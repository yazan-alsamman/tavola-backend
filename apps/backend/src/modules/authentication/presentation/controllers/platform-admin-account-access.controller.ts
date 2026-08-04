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
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
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
import { PlatformAdminForceLogoutUseCase } from '../../application/use-cases/platform-admin-force-logout.use-case';
import { PlatformAdminResetCredentialsUseCase } from '../../application/use-cases/platform-admin-reset-credentials.use-case';
import { PlatformAdminDisableLoginUseCase } from '../../application/use-cases/platform-admin-disable-login.use-case';
import { PlatformAdminEnableLoginUseCase } from '../../application/use-cases/platform-admin-enable-login.use-case';
import { PlatformAdminResetCredentialsRequestDto } from '../dto/platform-admin-reset-credentials.request.dto';

/**
 * ADR-034 §8, API_GUIDELINES.md's Platform Back Office Route Ownership table:
 * `/platform-admin/accounts/:userId/{force-logout,reset-credentials,disable-login,enable-login}`,
 * owned by Authentication, Pattern 1. Targets any User/Employee account -
 * both are `User` rows (an Employee's login identity IS a User, DOMAIN_MODEL.md),
 * so no separate mechanism is needed per actor type. PlatformAdmin-tier only.
 */
@ApiTags('Platform Admin - Account Access')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/accounts', version: '1' })
export class PlatformAdminAccountAccessController {
  constructor(
    private readonly forceLogoutUseCase: PlatformAdminForceLogoutUseCase,
    private readonly resetCredentialsUseCase: PlatformAdminResetCredentialsUseCase,
    private readonly disableLoginUseCase: PlatformAdminDisableLoginUseCase,
    private readonly enableLoginUseCase: PlatformAdminEnableLoginUseCase,
  ) {}

  @Post(':userId/force-logout')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account sessions revoked successfully.')
  @ApiOperation({
    operationId: 'platformAdminForceLogout',
    summary: 'Force logout every session of a User/Employee account (PlatformAdmin only)',
    description: 'Reuses the existing sessionVersion mechanism - no new event.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Account not found', ['NOT_FOUND'])
  async forceLogout(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.forceLogoutUseCase.execute({
      targetUserId: userId,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':userId/reset-credentials')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account credentials reset successfully.')
  @ApiOperation({
    operationId: 'platformAdminResetCredentials',
    summary: 'Directly reset a User/Employee account password (PlatformAdmin only)',
    description:
      "No OTP step - mirrors Restaurant Owner provisioning's trust model (ADR-022 Decision #15).",
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Account not found', ['NOT_FOUND'])
  async resetCredentials(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: PlatformAdminResetCredentialsRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.resetCredentialsUseCase.execute({
      targetUserId: userId,
      newPassword: body.newPassword,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':userId/disable-login')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account login disabled successfully.')
  @ApiOperation({
    operationId: 'platformAdminDisableLogin',
    summary: 'Disable login for a User/Employee account (PlatformAdmin only)',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Account not found', ['NOT_FOUND'])
  async disableLogin(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.disableLoginUseCase.execute({
      targetUserId: userId,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':userId/enable-login')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account login enabled successfully.')
  @ApiOperation({
    operationId: 'platformAdminEnableLogin',
    summary: 'Re-enable login for a previously-disabled User/Employee account (PlatformAdmin only)',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Account not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Account login is not currently disabled', ['CONFLICT'])
  async enableLogin(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.enableLoginUseCase.execute({
      targetUserId: userId,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
