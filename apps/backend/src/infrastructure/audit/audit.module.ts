import { Global, Module } from '@nestjs/common';
import { TenancyModule } from '@infrastructure/tenancy/tenancy.module';
import { AUDIT_LOG_WRITER } from '@shared/application/ports/audit-log-writer.port';
import { PrismaAuditLogWriter } from './prisma-audit-log-writer';

/**
 * `@Global()` so both `AuthenticationModule` (its event-publishing decorator)
 * and `AuthorizationModule` (`PermissionsGuard`) can inject `AUDIT_LOG_WRITER`
 * without one importing the other - `AuthenticationModule` already imports
 * `AuthorizationModule`, so the reverse would be circular. Audit logging is a
 * cross-cutting platform concern (ARCHITECTURE.md lists "Audit Logs"
 * alongside "Files"/"Settings" as its own concern, not nested under
 * Authentication), so a dedicated top-level `infrastructure/` module -
 * mirroring `TenancyModule`/`PrismaModule` - is the correct home, not a
 * module-owned repository like `LoginAttempt`.
 */
@Global()
@Module({
  imports: [TenancyModule],
  providers: [
    PrismaAuditLogWriter,
    { provide: AUDIT_LOG_WRITER, useExisting: PrismaAuditLogWriter },
  ],
  exports: [AUDIT_LOG_WRITER],
})
export class AuditModule {}
