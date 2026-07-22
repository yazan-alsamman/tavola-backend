import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
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
import { PlatformAdminLoginRequestDto } from '../dto/platform-admin-login.request.dto';
import { PlatformAdminLoginResponseDto } from '../dto/platform-admin-login.response.dto';
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
    });

    return {
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
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
