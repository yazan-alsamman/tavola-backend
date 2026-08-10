import { AuditActorType } from '@shared/application/ports/audit-log-writer.port';

/**
 * ADR-034 §2 - the Audit Log Read API's exact documented filter surface:
 * `actorId`/`targetType`/`targetId`/`action`/`organizationId`/date range,
 * paginated. No filter beyond this list is added (no `actorType`, no free-text
 * search) - ADR-034's own decision text is the ceiling, not a starting point.
 */
export interface ListAuditLogsFilter {
  readonly from: Date;
  readonly to: Date;
  readonly actorId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly action?: string;
  readonly organizationId?: string;
  readonly page: number;
  readonly limit: number;
}

export interface AuditLogRow {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorType: AuditActorType;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly organizationId: string | null;
  readonly correlationId: string | null;
  readonly ipAddress: string | null;
  readonly occurredAt: Date;
}

export interface ListAuditLogsResult {
  readonly items: AuditLogRow[];
  readonly total: number;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) - a genuinely cross-tenant
 * read, no single applicable tenant identity (an admin may query across
 * every Organization at once, or optionally narrow to one via the
 * `organizationId` filter - never a required path parameter identifying
 * "the target tenant" the way Pattern 1 requires). Reuses `AuditLog`'s
 * already-existing composite indexes (`(targetType, targetId)`,
 * `organizationId`, `occurredAt`) - no new index, read-only, no writer
 * logic here (see `AuditLogWriterPort` for writes - this port never writes).
 */
export interface AuditLogReaderPort {
  list(filter: ListAuditLogsFilter): Promise<ListAuditLogsResult>;
}

export const AUDIT_LOG_READER = Symbol('AUDIT_LOG_READER');
