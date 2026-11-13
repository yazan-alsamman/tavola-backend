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
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import {
  CreateBranchClosureUseCase,
  DeleteBranchClosureUseCase,
  ListBranchClosuresUseCase,
} from '../../application/use-cases/branch-closures.use-cases';
import { SetBranchPausedUseCase } from '../../application/use-cases/set-branch-paused.use-case';
import { BranchClosureResult } from '../../application/dto/branch-closure.dto';
import { BranchResult } from '../../application/dto/branch.result';
import { BranchClosureResponseDto, CreateBranchClosureRequestDto } from '../dto/branch-closure.dto';
import { BranchResponseDto } from '../dto/branch.response.dto';

/**
 * ADR-053: when a branch takes bookings - temporary closures and pausing the
 * branch's plan. Same Owner/Admin stack and tenant gate as BranchesController.
 */
@ApiTags('Branches')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/branches/:branchId', version: '1' })
export class BranchAvailabilityController {
  constructor(
    private readonly listClosures: ListBranchClosuresUseCase,
    private readonly createClosure: CreateBranchClosureUseCase,
    private readonly deleteClosure: DeleteBranchClosureUseCase,
    private readonly setPaused: SetBranchPausedUseCase,
  ) {}

  @Get('closures')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch closures retrieved successfully.')
  @ApiOperation({
    operationId: 'branchesListClosures',
    summary: 'List the branch closures that have not ended',
    description:
      'ADR-053: dates the branch takes no online bookings, without changing its weekly hours. Past closures are left out.',
  })
  @ApiResponse({ status: 200, type: BranchClosureResponseDto, isArray: true })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<BranchClosureResponseDto[]> {
    const rows = await this.listClosures.execute({ actor, restaurantId, branchId });
    return rows.map(toClosureResponse);
  }

  @Post('closures')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Branch closure created successfully.')
  @ApiOperation({
    operationId: 'branchesCreateClosure',
    summary: 'Close the branch for a range of dates',
    description:
      'ADR-053: both dates are inclusive, in the branch timezone, at most 366 days apart. Online time slots return Closed and new online bookings are refused on those dates. Existing reservations are kept.',
  })
  @ApiResponse({ status: 201, type: BranchClosureResponseDto })
  @ApiErrorResponse(400, 'Invalid dates or reason', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: CreateBranchClosureRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchClosureResponseDto> {
    const result = await this.createClosure.execute({
      actor,
      restaurantId,
      branchId,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toClosureResponse(result);
  }

  @Delete('closures/:closureId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'branchesDeleteClosure', summary: 'Remove a branch closure' })
  @ApiParam({ name: 'closureId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Closure removed' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, branch or closure not found', ['NOT_FOUND'])
  async remove(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('closureId', ParseUUIDPipe) closureId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteClosure.execute({
      actor,
      restaurantId,
      branchId,
      closureId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post('pause')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch paused successfully.')
  @ApiOperation({
    operationId: 'branchesPause',
    summary: 'Pause the branch',
    description:
      'ADR-053: the branch is hidden from guests and takes no online bookings until resumed. Staff keep managing existing reservations. Idempotent.',
  })
  @ApiResponse({ status: 200, type: BranchResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async pause(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchResponseDto> {
    return toBranchResponse(
      await this.setPaused.execute({
        actor,
        restaurantId,
        branchId,
        paused: true,
        correlationId: request.headers['x-correlation-id'] as string | undefined,
      }),
    );
  }

  @Post('resume')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch resumed successfully.')
  @ApiOperation({
    operationId: 'branchesResume',
    summary: 'Resume a paused branch',
    description: 'ADR-053: undoes pause. Idempotent.',
  })
  @ApiResponse({ status: 200, type: BranchResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async resume(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchResponseDto> {
    return toBranchResponse(
      await this.setPaused.execute({
        actor,
        restaurantId,
        branchId,
        paused: false,
        correlationId: request.headers['x-correlation-id'] as string | undefined,
      }),
    );
  }
}

function toClosureResponse(result: BranchClosureResult): BranchClosureResponseDto {
  return { ...result, createdAt: result.createdAt.toISOString() };
}

export function toBranchResponse(result: BranchResult): BranchResponseDto {
  return {
    ...result,
    trialEndsAt: result.trialEndsAt?.toISOString() ?? null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
