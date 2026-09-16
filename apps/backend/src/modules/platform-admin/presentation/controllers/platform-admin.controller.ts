import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { ProvisionRestaurantOwnerUseCase } from '@modules/authentication/application/use-cases/provision-restaurant-owner.use-case';
import { resolveClientIp } from '@modules/authentication/presentation/utils/resolve-client-ip.util';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminActor } from '../../application/dto/platform-admin-actor.dto';
import { PlatformAdminLoginUseCase } from '../../application/use-cases/platform-admin-login.use-case';
import { PlatformAdminRefreshUseCase } from '../../application/use-cases/platform-admin-refresh.use-case';
import { PlatformAdminLogoutUseCase } from '../../application/use-cases/platform-admin-logout.use-case';
import { GetCurrentPlatformAdminUseCase } from '../../application/use-cases/get-current-platform-admin.use-case';
import { PlatformAdminLoginRequestDto } from '../dto/platform-admin-login.request.dto';
import {
  PlatformAdminLoginResponseDto,
  PlatformAdminSessionResponseDto,
} from '../dto/platform-admin-login.response.dto';
import { PlatformAdminRefreshRequestDto } from '../dto/platform-admin-refresh.request.dto';
import { PlatformAdminLogoutRequestDto } from '../dto/platform-admin-logout.request.dto';
import { PlatformAdminMeResponseDto } from '../dto/platform-admin-me.response.dto';
import { ProvisionRestaurantOwnerRequestDto } from '../dto/provision-restaurant-owner.request.dto';
import { ProvisionRestaurantOwnerResponseDto } from '../dto/provision-restaurant-owner.response.dto';

/**
 * ADR-022 §"Platform Admin Authentication" (Phase 2.23 closure, approved
 * decision). `login` is public (it IS the authentication step); every
 * other route requires `PlatformAdminGuard` alone - deliberately NOT
 * `JwtAuthGuard` first, since that guard verifies against the ordinary
 * tenant/actor JWT secret/issuer/audience, which must never be accepted
 * here (see `PlatformAdminGuard`'s own doc comment).
 */
@ApiTags('Platform Admin')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin', version: '1' })
export class PlatformAdminController {
  constructor(
    private readonly platformAdminLoginUseCase: PlatformAdminLoginUseCase,
    private readonly platformAdminRefreshUseCase: PlatformAdminRefreshUseCase,
    private readonly platformAdminLogoutUseCase: PlatformAdminLogoutUseCase,
    private readonly getCurrentPlatformAdminUseCase: GetCurrentPlatformAdminUseCase,
    private readonly provisionRestaurantOwnerUseCase: ProvisionRestaurantOwnerUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Login successful.')
  @ApiOperation({
    operationId: 'platformAdminLogin',
    summary: 'Authenticate as Platform Admin (isolated issuer/audience)',
    description:
      'Validates email + password against the underlying User row and its active PlatformAdmin record, then issues a short-lived access token signed with the Platform Admin-only issuer/audience/secret. There is no Platform Admin self-registration - accounts are provisioned operationally.',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: PlatformAdminLoginResponseDto,
  })
  @ApiErrorResponse(401, 'Invalid credentials, or not an active Platform Admin', [
    'AUTH_INVALID_CREDENTIALS',
  ])
  async login(
    @Body() body: PlatformAdminLoginRequestDto,
    @Req() request: Request,
  ): Promise<PlatformAdminLoginResponseDto> {
    const result = await this.platformAdminLoginUseCase.execute({
      email: body.email,
      password: body.password,
      ipAddress: resolveClientIp(request),
      userAgent: request.headers['user-agent'],
    });

    return toSessionResponse(result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session refreshed successfully.')
  @ApiOperation({
    operationId: 'platformAdminRefresh',
    summary: 'Rotate a Platform Admin refresh token and issue a new access token',
    description:
      'Public - it authenticates via the refresh token itself, exactly like POST /auth/refresh. The presented token is consumed and a new pair returned. Replaying an already-rotated token is treated as theft: every session belonging to that admin is revoked and the attempt audited, forcing a full re-login. Unknown, expired, revoked and replayed tokens are indistinguishable in the response.',
  })
  @ApiResponse({
    status: 200,
    description: 'Session refreshed',
    type: PlatformAdminSessionResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Invalid, expired, revoked, or replayed refresh token', [
    'AUTH_INVALID_REFRESH_TOKEN',
  ])
  async refresh(
    @Body() body: PlatformAdminRefreshRequestDto,
    @Req() request: Request,
  ): Promise<PlatformAdminSessionResponseDto> {
    const result = await this.platformAdminRefreshUseCase.execute({
      refreshToken: body.refreshToken,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });

    return toSessionResponse(result);
  }

  @Post('logout')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'platformAdminLogout',
    summary: 'End one Platform Admin console session',
    description:
      'Revokes the PlatformAdminSession identified by the supplied refresh token, so that token stops working immediately. The already-issued access token stays valid until it expires (900s default) - an inherent property of stateless JWT verification, identical to POST /auth/logout. Idempotent and non-enumerating: an unknown, already-revoked, or another admin token all return 204.',
  })
  @ApiResponse({ status: 204, description: 'Session ended' })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Missing, malformed, or expired access token', ['UNAUTHORIZED'])
  @ApiErrorResponse(403, 'Caller is no longer an active Platform Admin', ['FORBIDDEN'])
  async logout(
    @Body() body: PlatformAdminLogoutRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.platformAdminLogoutUseCase.execute({
      refreshToken: body.refreshToken,
      actorId: actor.userId,
      ipAddress: resolveClientIp(request),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Get('me')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Current Platform Admin retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetMe',
    summary: 'Identity and live role of the authenticated Platform Admin',
    description:
      'What a console calls on boot to answer "am I still signed in, and as whom?" without decoding the JWT client-side. Available to both Platform tiers - it reports the caller own role rather than requiring a particular one.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current admin retrieved',
    type: PlatformAdminMeResponseDto,
  })
  @ApiErrorResponse(401, 'Missing, malformed, or expired access token', ['UNAUTHORIZED'])
  @ApiErrorResponse(403, 'Caller is no longer an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Platform Admin grant or User row no longer exists', ['NOT_FOUND'])
  async me(@CurrentPlatformAdmin() actor: PlatformAdminActor): Promise<PlatformAdminMeResponseDto> {
    const result = await this.getCurrentPlatformAdminUseCase.execute({
      platformAdminUserId: actor.userId,
    });

    return {
      userId: result.userId,
      platformAdminId: result.platformAdminId,
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      role: result.role,
      status: result.status,
      platformAdminCreatedAt: result.platformAdminCreatedAt.toISOString(),
    };
  }

  @Post('restaurant-owners')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Restaurant Owner provisioned successfully.')
  @ApiOperation({
    operationId: 'platformAdminProvisionRestaurantOwner',
    summary: 'Provision a Restaurant Owner account (Platform Admin only)',
    description:
      'Creates a Restaurant Owner User and its Organization/OrganizationMember in one transaction, immediately Active with no email-verification step (ADR-022). Credential communication to the Owner is out-of-band and outside backend scope - the password supplied here is the final password, not a temporary one. Requires a Platform Admin access token (POST /platform-admin/login), never an ordinary Customer/Owner/Employee token.',
  })
  @ApiResponse({
    status: 201,
    description: 'Owner provisioned',
    type: ProvisionRestaurantOwnerResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(409, 'Email or organization slug already exists', ['CONFLICT'])
  async provisionRestaurantOwner(
    @Body() body: ProvisionRestaurantOwnerRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<ProvisionRestaurantOwnerResponseDto> {
    return this.provisionRestaurantOwnerUseCase.execute({
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      organizationName: body.organizationName,
      consents: body.consents,
      provisionedByPlatformAdminId: actor.userId,
      ipAddress: resolveClientIp(request),
    });
  }
}

/**
 * Login and Refresh return the identical wire shape; this is the single
 * place an application result is projected onto it, so the two handlers
 * cannot drift apart.
 */
function toSessionResponse(result: {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  platformAdminUserId: string;
  role: string;
}): PlatformAdminSessionResponseDto {
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    tokenType: result.tokenType,
    accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
    platformAdminUserId: result.platformAdminUserId,
    role: result.role as PlatformAdminSessionResponseDto['role'],
  };
}
