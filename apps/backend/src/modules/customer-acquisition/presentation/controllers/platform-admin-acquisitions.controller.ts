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
import { ReverseCustomerAcquisitionUseCase } from '../../application/use-cases/reverse-customer-acquisition.use-case';
import { ManuallyRecordCustomerAcquisitionUseCase } from '../../application/use-cases/manually-record-customer-acquisition.use-case';
import { ListCustomerAcquisitionsUseCase } from '../../application/use-cases/list-customer-acquisitions.use-case';
import { GetCustomerAcquisitionUseCase } from '../../application/use-cases/get-customer-acquisition.use-case';
import { ReverseAcquisitionRequestDto } from '../dto/reverse-acquisition.request.dto';
import { ManuallyRecordAcquisitionRequestDto } from '../dto/manually-record-acquisition.request.dto';
import { ListAcquisitionsQueryDto } from '../dto/list-acquisitions.query.dto';
import {
  CustomerAcquisitionListResponseDto,
  CustomerAcquisitionResponseDto,
} from '../dto/customer-acquisition.response.dto';
import { toCustomerAcquisitionResponse } from './customer-acquisition-response.mapper';

/**
 * ADR-033 §10/§11, API_GUIDELINES.md's Platform Back Office Route Ownership
 * table: `/platform-admin/acquisitions*`, new `customer-acquisition` module,
 * Pattern 1 (mutation). Reads (`List`) are available to both Platform tiers
 * (ADR-034 §11's "PlatformSupport is read-only, no mutation authority");
 * Reverse/ManuallyRecord are PlatformAdmin-only.
 */
@ApiTags('Platform Admin - Customer Acquisition')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/acquisitions', version: '1' })
export class PlatformAdminAcquisitionsController {
  constructor(
    private readonly reverseCustomerAcquisitionUseCase: ReverseCustomerAcquisitionUseCase,
    private readonly manuallyRecordCustomerAcquisitionUseCase: ManuallyRecordCustomerAcquisitionUseCase,
    private readonly listCustomerAcquisitionsUseCase: ListCustomerAcquisitionsUseCase,
    private readonly getCustomerAcquisitionUseCase: GetCustomerAcquisitionUseCase,
  ) {}

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Customer acquisitions retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListCustomerAcquisitions',
    summary: 'List Customer Acquisitions for one Restaurant (PlatformAdmin or PlatformSupport)',
  })
  @ApiResponse({
    status: 200,
    description: 'Acquisitions retrieved',
    type: CustomerAcquisitionListResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['RESTAURANT_NOT_FOUND'])
  async list(
    @Query() query: ListAcquisitionsQueryDto,
  ): Promise<CustomerAcquisitionListResponseDto> {
    const result = await this.listCustomerAcquisitionsUseCase.execute({
      restaurantId: query.restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toCustomerAcquisitionResponse),
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
  @ResponseMessage('Customer acquisition retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetCustomerAcquisition',
    summary: 'Narrow lookup of a Customer Acquisition by id (PlatformAdmin or PlatformSupport)',
    description:
      'ADR-034 §13 - CustomerAcquisition carries no name/text field, so id is the only applicable lookup axis. A support tool, not a search engine.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Acquisition retrieved',
    type: CustomerAcquisitionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Acquisition not found', ['NOT_FOUND'])
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerAcquisitionResponseDto> {
    const result = await this.getCustomerAcquisitionUseCase.execute(id);
    return toCustomerAcquisitionResponse(result);
  }

  @Post(':id/reverse')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Customer acquisition reversed successfully.')
  @ApiOperation({
    operationId: 'platformAdminReverseCustomerAcquisition',
    summary: 'Reverse a Customer Acquisition - corrects an over-count (PlatformAdmin only)',
    description:
      'Never automatic - a PlatformAdmin-only compensating action (ADR-033 §10). Frees the uniqueness slot; a genuinely new qualifying event afterward may create a fresh record.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Acquisition reversed',
    type: CustomerAcquisitionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Acquisition not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Acquisition has already been reversed', ['CONFLICT'])
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReverseAcquisitionRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<CustomerAcquisitionResponseDto> {
    const result = await this.reverseCustomerAcquisitionUseCase.execute({
      acquisitionId: id,
      reason: body.reason,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toCustomerAcquisitionResponse(result);
  }

  @Post('manual')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Customer acquisition manually recorded successfully.')
  @ApiOperation({
    operationId: 'platformAdminManuallyRecordCustomerAcquisition',
    summary:
      'Manually record a Customer Acquisition - corrects an under-count (PlatformAdmin only)',
    description:
      'Symmetric to Reverse (ADR-033 §11) - still governed by the same one-active-acquisition-per-(Restaurant, Customer-Identity) uniqueness constraint. Permanently distinguished from an automatic record via createdVia.',
  })
  @ApiResponse({
    status: 201,
    description: 'Acquisition recorded',
    type: CustomerAcquisitionResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['RESTAURANT_NOT_FOUND'])
  @ApiErrorResponse(409, 'An active acquisition already exists for this pair', ['VALIDATION_ERROR'])
  @ApiErrorResponse(422, 'No matching pricing rule for the restaurant’s operating currency', [
    'NO_MATCHING_PRICING_RULE',
  ])
  async manuallyRecord(
    @Body() body: ManuallyRecordAcquisitionRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<CustomerAcquisitionResponseDto> {
    const result = await this.manuallyRecordCustomerAcquisitionUseCase.execute({
      restaurantId: body.restaurantId,
      userId: body.userId ?? null,
      reservationGuestId: body.reservationGuestId ?? null,
      reason: body.reason,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toCustomerAcquisitionResponse(result);
  }
}
