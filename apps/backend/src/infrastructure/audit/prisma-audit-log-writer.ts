import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { AuditLogEntry, AuditLogWriterPort } from '@shared/application/ports/audit-log-writer.port';

/**
 * `AuditLog` is deliberately NOT added to `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` allowlist even though it carries an
 * `organizationId` column: unlike `Restaurant`/`OrganizationMember` (which
 * always belong to exactly one tenant), most audited actions this phase
 * covers - login, registration, forgot-password, JWT verification failures -
 * happen with NO tenant context bound at all (pre-authentication or
 * account-level actions). Fail-closed tenant enforcement would reject every
 * one of those writes. `PrismaContext` is still used (not raw
 * `PrismaService`) because the extension is a verified no-op passthrough for
 * any model outside that allowlist - this is an ordinary, unscoped write.
 *
 * Every failure is caught and logged, never rethrown: an audit-write outage
 * must not break the login/logout/refresh/permission-check it was recording
 * (NON_FUNCTIONAL_REQUIREMENTS.md's fault-tolerance rule - audit logging is
 * observability, not a security control whose failure should block
 * legitimate traffic). This is the single place that policy lives, so every
 * caller (the event-publishing decorator and the three guards) gets it for
 * free without repeating a try/catch.
 */
@Injectable()
export class PrismaAuditLogWriter implements AuditLogWriterPort {
  private readonly logger = new Logger(PrismaAuditLogWriter.name);

  constructor(private readonly prismaContext: PrismaContext) {}

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prismaContext.client.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: entry.actorId,
          actorType: entry.actorType,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          organizationId: entry.organizationId,
          correlationId: entry.correlationId,
          ipAddress: entry.ipAddress,
          occurredAt: entry.occurredAt,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log entry for action "${entry.action}": ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
