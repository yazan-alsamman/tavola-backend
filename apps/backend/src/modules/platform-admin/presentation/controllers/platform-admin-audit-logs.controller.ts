import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '../guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '../decorators/require-platform-admin-role.decorator';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { ListAuditLogsUseCase } from '../../application/use-cases/list-audit-logs.use-case';
import { ListAuditLogsQueryDto } from '../dto/list-audit-logs.query.dto';
import { AuditLogListResponseDto } from '../dto/audit-log.response.dto';

/**
 * ADR-034 §2, API_GUIDELINES.md's Platform Back Office Route Ownership
 * table: `/platform-admin/audit-logs`, Pattern 2 (ADR-035). Read-only,
 * available to both Platform tiers (§11's "PlatformSupport is read-only...
 * Audit Log reads"). This GET never writes its own `AuditLog` row (ADR-028
 * §14's "ordinary GET requests do not create AuditLog rows" precedent,
 * reused verbatim - reads are audited only on RBAC denial, already handled
 * by `PlatformAdminRoleGuard` itself).
 */
@ApiTags('Platform Admin - Audit Logs')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/audit-logs', version: '1' })
export class PlatformAdminAuditLogsController {
  constructor(private readonly listAuditLogsUseCase: ListAuditLogsUseCase) {}

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Audit logs retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminListAuditLogs',
    summary: 'List platform-wide Audit Log entries (PlatformAdmin or PlatformSupport)',
    description:
      "ADR-034 §2 - filterable by actorId/targetType/targetId/action/organizationId, bounded by a required from/to date range (max 366 days, mirrors ADR-028 §13). Ordered newest-first. Reuses AuditLog's existing composite indexes - no new index, no new writer logic.",
  })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved', type: AuditLogListResponseDto })
  @ApiErrorResponse(400, 'Invalid or excessive date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async list(@Query() query: ListAuditLogsQueryDto): Promise<AuditLogListResponseDto> {
    const result = await this.listAuditLogsUseCase.execute({
      from: new Date(query.from),
      to: new Date(query.to),
      actorId: query.actorId,
      targetType: query.targetType,
      targetId: query.targetId,
      action: query.action,
      organizationId: query.organizationId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });

    return {
      items: result.items.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorType: row.actorType,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        organizationId: row.organizationId,
        correlationId: row.correlationId,
        ipAddress: row.ipAddress,
        occurredAt: row.occurredAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }
}
