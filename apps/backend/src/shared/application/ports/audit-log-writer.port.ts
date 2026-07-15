/**
 * The three actor categories DATABASE_SCHEMA.md's "Audit Logs" section
 * defines. Deliberately narrower than the JWT `AccessTokenActorType` union
 * (`User`/`Employee`/`OrganizationMember`/`PlatformAdmin`) - that is a
 * request-authentication concept, this is the audit table's own documented
 * schema. Callers map `OrganizationMember`/`PlatformAdmin` actors onto
 * `User` (the closest fit within the three documented values) rather than
 * expanding this enum, which would be an undocumented schema change.
 */
export type AuditActorType = 'User' | 'Employee' | 'System';

/**
 * Mirrors DATABASE_SCHEMA.md's "Audit Logs" field list exactly - no
 * additional columns (no `metadata` JSON bucket, no `sessionId`/`userAgent`
 * columns) since none are documented there, and adding one would be a schema
 * change requiring `DATABASE_SCHEMA.md` to be updated first per
 * `CHANGE_POLICY.md`, out of this phase's "update only TASKS/README/ROADMAP"
 * instruction. `action` and `targetType`/`targetId` carry enough specificity
 * for every case this phase needs.
 */
export interface AuditLogEntry {
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

/**
 * Deliberately fire-and-forget from the caller's perspective: every
 * implementation must swallow its own failures (log, never throw) so an
 * audit-write outage can never break a login/logout/permission-check/etc.
 * request - audit logging is observability, not a security control whose
 * failure should block legitimate traffic (NON_FUNCTIONAL_REQUIREMENTS.md's
 * fault-tolerance rule). See `PrismaAuditLogWriter` for the concrete policy.
 */
export interface AuditLogWriterPort {
  record(entry: AuditLogEntry): Promise<void>;
}

export const AUDIT_LOG_WRITER = Symbol('AUDIT_LOG_WRITER');
