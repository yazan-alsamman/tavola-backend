import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { PlatformAdminGuard } from '@modules/platform-admin/presentation/guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '@modules/platform-admin/presentation/guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '@modules/platform-admin/presentation/decorators/require-platform-admin-role.decorator';
import { PlatformAdminRole } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { GetRevenueReportUseCase } from '../../application/use-cases/get-revenue-report.use-case';
import { ExportCustomerAcquisitionsUseCase } from '../../application/use-cases/export-customer-acquisitions.use-case';
import { RevenueReportQueryDto, RevenueReportResponseDto } from '../dto/revenue-report.query.dto';
import {
  ExportAcquisitionsQueryDto,
  ExportAcquisitionsResponseDto,
} from '../dto/export-acquisitions.query.dto';

/**
 * ADR-033 §22-24, API_GUIDELINES.md's Platform Back Office Route Ownership
 * table: `/platform-admin/revenue*`, new `customer-acquisition` module
 * (revenue), Pattern 2 (Tenant-Agnostic Raw Reader) - genuinely cross-tenant
 * reads spanning every Restaurant/Organization at once. Read-only,
 * available to both Platform tiers (ADR-034 §11).
 */
@ApiTags('Platform Admin - Revenue')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/revenue', version: '1' })
export class PlatformAdminRevenueController {
  constructor(
    private readonly getRevenueReportUseCase: GetRevenueReportUseCase,
    private readonly exportCustomerAcquisitionsUseCase: ExportCustomerAcquisitionsUseCase,
  ) {}

  @Get('report')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Revenue report computed successfully.')
  @ApiOperation({
    operationId: 'platformAdminGetRevenueReport',
    summary: 'Revenue report over CustomerAcquisition (PlatformAdmin or PlatformSupport)',
    description:
      'Recorded/Reversed metrics only (ADR-033 §22) - never Collected/Outstanding, TAVLA does not observe payment state. Buckets are additionally partitioned by currency - never summed across currencies (no FX conversion, ever).',
  })
  @ApiResponse({ status: 200, description: 'Report computed', type: RevenueReportResponseDto })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async report(@Query() query: RevenueReportQueryDto): Promise<RevenueReportResponseDto> {
    return this.getRevenueReportUseCase.execute({
      from: new Date(query.from),
      to: new Date(query.to),
      groupBy: query.groupBy,
      restaurantId: query.restaurantId,
      organizationId: query.organizationId,
    });
  }

  @Get('export')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Customer acquisitions exported successfully.')
  @ApiOperation({
    operationId: 'platformAdminExportCustomerAcquisitions',
    summary: 'Structured export of CustomerAcquisition records (PlatformAdmin or PlatformSupport)',
    description:
      'ADR-033 §23 - the entire invoice-readiness mechanism, together with the fee snapshot; no settlement/invoice-reference field exists. Synchronous only in this phase (Heavy Operations <=30s branch) - date range capped at 366 days.',
  })
  @ApiResponse({ status: 200, description: 'Export computed', type: ExportAcquisitionsResponseDto })
  @ApiErrorResponse(400, 'Invalid or excessive date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async export(@Query() query: ExportAcquisitionsQueryDto): Promise<ExportAcquisitionsResponseDto> {
    const result = await this.exportCustomerAcquisitionsUseCase.execute({
      from: new Date(query.from),
      to: new Date(query.to),
      restaurantId: query.restaurantId,
      organizationId: query.organizationId,
    });
    return {
      total: result.total,
      rows: result.rows.map((row) => ({
        id: row.id,
        restaurantId: row.restaurantId,
        organizationId: row.organizationId,
        customerIdentityKey: row.customerIdentityKey,
        createdVia: row.createdVia,
        status: row.status,
        feeAmount: row.feeAmount,
        feeCurrency: row.feeCurrency,
        recordedAt: row.recordedAt.toISOString(),
        reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
      })),
    };
  }
}
