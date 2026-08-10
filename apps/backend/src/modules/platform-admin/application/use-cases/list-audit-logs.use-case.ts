import { Injectable, Inject } from '@nestjs/common';
import { AuditLogReaderPort, AUDIT_LOG_READER, AuditLogRow } from '../ports/audit-log-reader.port';
import { InvalidAuditLogQueryException } from '../../domain/exceptions/invalid-audit-log-query.exception';

const MAX_AUDIT_LOG_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ListAuditLogsQuery {
  from: Date;
  to: Date;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  organizationId?: string;
  page: number;
  limit: number;
}

export interface ListAuditLogsResult {
  items: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * ADR-034 §2 - read-only, available to both Platform tiers (§11). Bounded
 * date range required, mirroring ADR-028 §13's 366-day cap
 * (`ExportCustomerAcquisitionsUseCase`'s identical precedent): `AuditLog` is
 * a high-write-volume, append-only table at platform scale, so an
 * admin-supplied `from`/`to` window - not page/limit alone - is what
 * actually bounds query cost. No Tenant Context rebind (ADR-035 Pattern 2's
 * own "Audit: none required" rule) - this is a read with no domain event and
 * no RBAC denial, so it never writes its own `AuditLog` row.
 */
@Injectable()
export class ListAuditLogsUseCase {
  constructor(@Inject(AUDIT_LOG_READER) private readonly auditLogReader: AuditLogReaderPort) {}

  async execute(query: ListAuditLogsQuery): Promise<ListAuditLogsResult> {
    if (query.from.getTime() >= query.to.getTime()) {
      throw new InvalidAuditLogQueryException('from must be strictly before to.');
    }
    const rangeDays = (query.to.getTime() - query.from.getTime()) / MILLISECONDS_PER_DAY;
    if (rangeDays > MAX_AUDIT_LOG_RANGE_DAYS) {
      throw new InvalidAuditLogQueryException(
        `Audit log query date range must not exceed ${MAX_AUDIT_LOG_RANGE_DAYS} days.`,
      );
    }

    const result = await this.auditLogReader.list({
      from: query.from,
      to: query.to,
      actorId: query.actorId,
      targetType: query.targetType,
      targetId: query.targetId,
      action: query.action,
      organizationId: query.organizationId,
      page: query.page,
      limit: query.limit,
    });

    return {
      items: result.items,
      total: result.total,
      page: query.page,
      limit: query.limit,
    };
  }
}
