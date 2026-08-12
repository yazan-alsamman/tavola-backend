import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
import { ActivatePricingRuleUseCase } from '../../application/use-cases/activate-pricing-rule.use-case';
import { ListPricingRulesUseCase } from '../../application/use-cases/list-pricing-rules.use-case';
import { SimulatePricingUseCase } from '../../application/use-cases/simulate-pricing.use-case';
import { ActivatePricingRuleRequestDto } from '../dto/activate-pricing-rule.request.dto';
import { ListPricingRulesQueryDto } from '../dto/list-pricing-rules.query.dto';
import {
  SimulatePricingRequestDto,
  SimulatePricingResponseDto,
} from '../dto/simulate-pricing.request.dto';
import {
  PricingRuleListResponseDto,
  PricingRuleResponseDto,
} from '../dto/pricing-rule.response.dto';
import { toPricingRuleResponse } from './customer-acquisition-response.mapper';

/**
 * ADR-033 §14-19, API_GUIDELINES.md's Platform Back Office Route Ownership
 * table: `/platform-admin/pricing*`, new `customer-acquisition` module,
 * Pattern 1 (mutation). List/Simulate are read-only, available to both
 * Platform tiers; Activate is PlatformAdmin-only.
 */
@ApiTags('Platform Admin - Acquisition Pricing')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/pricing', version: '1' })
export class PlatformAdminPricingController {
  constructor(
    private readonly activatePricingRuleUseCase: ActivatePricingRuleUseCase,
    private readonly listPricingRulesUseCase: ListPricingRulesUseCase,
    private readonly simulatePricingUseCase: SimulatePricingUseCase,
  ) {}

  @Get('rules')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Pricing rules retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListPricingRules',
    summary: 'List/lookup Acquisition Pricing Rules, any scope (PlatformAdmin or PlatformSupport)',
    description:
      'ADR-034 §13 - optional label (case-insensitive partial match) and id (exact) filters, a narrow lookup tool. Omit both to list every rule.',
  })
  @ApiResponse({ status: 200, description: 'Rules retrieved', type: PricingRuleListResponseDto })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async list(@Query() query: ListPricingRulesQueryDto): Promise<PricingRuleListResponseDto> {
    const result = await this.listPricingRulesUseCase.execute({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      label: query.label,
      id: query.id,
    });
    return {
      items: result.items.map(toPricingRuleResponse),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Post('rules')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Pricing rule activated successfully.')
  @ApiOperation({
    operationId: 'platformAdminActivatePricingRule',
    summary: 'Activate a new Acquisition Pricing Rule (PlatformAdmin only)',
    description:
      'Rules are never edited in place (ADR-033 §15) - a pricing change always creates a new row. Pass supersedesRuleId to archive the previous rule in the same operation. feeType "Percentage" is rejected (§16) - not yet supported.',
  })
  @ApiResponse({ status: 201, description: 'Rule activated', type: PricingRuleResponseDto })
  @ApiErrorResponse(400, 'Validation failure, or feeType Percentage was requested', [
    'VALIDATION_ERROR',
    'PERCENTAGE_PRICING_NOT_SUPPORTED',
  ])
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'scopeId does not reference an existing Organization/Restaurant', [
    'NOT_FOUND',
    'RESTAURANT_NOT_FOUND',
  ])
  async activate(
    @Body() body: ActivatePricingRuleRequestDto,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PricingRuleResponseDto> {
    const result = await this.activatePricingRuleUseCase.execute({
      scopeType: body.scopeType,
      scopeId: body.scopeId ?? null,
      feeType: body.feeType,
      flatAmount: body.flatAmount,
      flatCurrency: body.flatCurrency,
      effectiveFrom: new Date(body.effectiveFrom),
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
      label: body.label,
      supersedesRuleId: body.supersedesRuleId,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPricingRuleResponse(result);
  }

  @Post('simulate')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Pricing simulation computed successfully.')
  @ApiOperation({
    operationId: 'platformAdminSimulatePricing',
    summary:
      'Preview a proposed fee against recent acquisition volume (PlatformAdmin or PlatformSupport)',
    description:
      'Stateless, read-only (ADR-033 §19) - nothing is persisted. isEstimateOnly is always true; never a commitment.',
  })
  @ApiResponse({
    status: 200,
    description: 'Simulation computed',
    type: SimulatePricingResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['RESTAURANT_NOT_FOUND'])
  async simulate(@Body() body: SimulatePricingRequestDto): Promise<SimulatePricingResponseDto> {
    return this.simulatePricingUseCase.execute({
      restaurantId: body.restaurantId,
      proposedFlatAmount: body.proposedFlatAmount,
      proposedFlatCurrency: body.proposedFlatCurrency,
      lookbackDays: body.lookbackDays,
    });
  }
}
