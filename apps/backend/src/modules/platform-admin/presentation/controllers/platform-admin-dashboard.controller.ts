import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { GetPlatformDashboardUseCase } from '../../application/use-cases/get-platform-dashboard.use-case';
import { PlatformDashboardQueryDto } from '../dto/platform-dashboard.query.dto';
import { PlatformDashboardResponseDto } from '../dto/platform-dashboard.response.dto';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '../guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '../decorators/require-platform-admin-role.decorator';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

/**
 * Phase 19 — Platform Dashboard composition endpoint. API_GUIDELINES.md's
 * Platform Back Office Route Ownership table: `/platform-admin/dashboard`,
 * "Platform Admin module (dashboard composition)", Pattern 2 (ADR-035).
 * Read-only, available to both Platform tiers (ADR-034 §11) - identical
 * guard/decorator shape to `PlatformAdminAuditLogsController`/
 * `PlatformAdminRevenueController`. This GET never writes its own
 * `AuditLog` row (reads are audited only on RBAC denial, already handled by
 * `PlatformAdminRoleGuard`).
 */
@ApiTags('Platform Admin - Dashboard')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/dashboard', version: '1' })
export class PlatformAdminDashboardController {
  constructor(private readonly getPlatformDashboardUseCase: GetPlatformDashboardUseCase) {}

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Platform dashboard computed successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetDashboard',
    summary: 'Composed Platform Dashboard (PlatformAdmin or PlatformSupport)',
    description:
      'Parallelized reads across Restaurant/Organization/Subscription/Messaging (current-state snapshots) and Customer Acquisition/Revenue (time-series, bounded by the required from/to range, max 366 days). Composes existing read capabilities only - no new metrics, no new persistence.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard computed',
    type: PlatformDashboardResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid or excessive date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async get(@Query() query: PlatformDashboardQueryDto): Promise<PlatformDashboardResponseDto> {
    const result = await this.getPlatformDashboardUseCase.execute({
      from: new Date(query.from),
      to: new Date(query.to),
    });

    return {
      generatedAt: result.generatedAt.toISOString(),
      restaurants: result.restaurants,
      organizations: result.organizations,
      subscriptions: result.subscriptions,
      acquisition: {
        from: result.acquisition.from.toISOString(),
        to: result.acquisition.to.toISOString(),
        currencies: result.acquisition.currencies,
      },
      messaging: result.messaging,
    };
  }
}
