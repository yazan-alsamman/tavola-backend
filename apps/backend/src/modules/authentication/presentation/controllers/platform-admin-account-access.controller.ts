import {
  Body,
  Controller,
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
import { PlatformAdminListAccountsUseCase } from '../../application/use-cases/platform-admin-list-accounts.use-case';
import { PlatformAdminGetAccountUseCase } from '../../application/use-cases/platform-admin-get-account.use-case';
import { PlatformAdminResetCredentialsRequestDto } from '../dto/platform-admin-reset-credentials.request.dto';
import {
  PlatformAdminAccountDetailResponseDto,
  PlatformAdminAccountListResponseDto,
  PlatformAdminAccountSummaryResponseDto,
  SearchPlatformAdminAccountsQueryDto,
} from '../dto/platform-admin-account.response.dto';
import { PlatformAdminAccountRow } from '../../application/ports/platform-admin-account-reader.port';

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
    private readonly listAccountsUseCase: PlatformAdminListAccountsUseCase,
    private readonly getAccountUseCase: PlatformAdminGetAccountUseCase,
  ) {}

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Accounts retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListAccounts',
    summary: 'Paginated, searchable listing of every account (PlatformAdmin or PlatformSupport)',
    description:
      'The lookup that makes the four /platform-admin/accounts/:userId actions usable - without it an operator would have to obtain a userId from somewhere outside the API. Case-insensitive partial match across email, phone, username, first and last name; q omitted, empty, or whitespace-only returns the ordinary paginated list rather than nothing. Optional status (UserStatus) and accountType filters. Newest first. Read-only, so both Platform tiers may call it. Never exposes password hashes or session/permissions versions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Accounts retrieved',
    type: PlatformAdminAccountListResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Missing, malformed, or expired access token', ['UNAUTHORIZED'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async list(
    @Query() query: SearchPlatformAdminAccountsQueryDto,
  ): Promise<PlatformAdminAccountListResponseDto> {
    const result = await this.listAccountsUseCase.execute({
      q: query.q ?? '',
      status: query.status,
      accountType: query.accountType,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });

    return {
      items: result.items.map(toAccountSummary),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Get(':userId')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetAccount',
    summary: 'Full account detail by userId (PlatformAdmin or PlatformSupport)',
    description:
      'Includes the operational state a support console needs to answer "why can this account not log in?" in one call: status, emailVerified, failedLoginCount, lockedUntil, active session count, pending-deletion timestamps, and Organization memberships. Soft-deleted and anonymized accounts are returned (with deletedAt/anonymizedAt set) rather than 404 - seeing that an account was deleted is the point of looking it up. Only a nonexistent id is a 404.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Account retrieved',
    type: PlatformAdminAccountDetailResponseDto,
  })
  @ApiErrorResponse(401, 'Missing, malformed, or expired access token', ['UNAUTHORIZED'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Account not found', ['NOT_FOUND'])
  async get(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<PlatformAdminAccountDetailResponseDto> {
    const row = await this.getAccountUseCase.execute({ userId });

    return {
      ...toAccountSummary(row),
      language: row.language,
      preferredCurrency: row.preferredCurrency,
      notificationOptIn: row.notificationOptIn,
      marketingOptIn: row.marketingOptIn,
      failedLoginCount: row.failedLoginCount,
      lockedUntil: row.lockedUntil ? row.lockedUntil.toISOString() : null,
      passwordChangedAt: row.passwordChangedAt ? row.passwordChangedAt.toISOString() : null,
      deletionRequestedAt: row.deletionRequestedAt ? row.deletionRequestedAt.toISOString() : null,
      scheduledAnonymizationAt: row.scheduledAnonymizationAt
        ? row.scheduledAnonymizationAt.toISOString()
        : null,
      anonymizedAt: row.anonymizedAt ? row.anonymizedAt.toISOString() : null,
      activeSessionCount: row.activeSessionCount,
      organizations: row.organizations,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

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

/**
 * List and detail share every summary field; projecting them in one place
 * keeps the two responses from drifting.
 */
function toAccountSummary(row: PlatformAdminAccountRow): PlatformAdminAccountSummaryResponseDto {
  return {
    userId: row.userId,
    email: row.email,
    phone: row.phone,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    accountType: row.accountType,
    emailVerified: row.emailVerified,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
