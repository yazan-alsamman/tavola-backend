import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import {
  PLATFORM_ADMIN_ACTOR_KEY,
  PlatformAdminActor,
} from '../../application/dto/platform-admin-actor.dto';
import { PlatformAdminRoleRequiredException } from '../../domain/exceptions/platform-admin-role-required.exception';
import { REQUIRE_PLATFORM_ADMIN_ROLE_KEY } from '../decorators/require-platform-admin-role.decorator';

/**
 * ADR-034 §11-12 — the two-tier Platform role check, run strictly after
 * `PlatformAdminGuard` (which authenticates and populates
 * `PLATFORM_ADMIN_ACTOR_KEY`). Thin by design, matching `OrganizationMemberGuard`:
 * reads the role already embedded in the verified actor, no extra database
 * round trip here (`PlatformAdminGuard` already re-verified the live role,
 * see its own doc comment). Fail-closed: missing `@RequirePlatformAdminRole`
 * metadata, a missing actor (misconfigured guard order), or a role outside
 * the declared allow-list are all denied, never an implicit pass-through.
 */
@Injectable()
export class PlatformAdminRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[] | undefined>(
      REQUIRE_PLATFORM_ADMIN_ROLE_KEY,
      context.getHandler(),
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      // Fail closed (default deny): a route guarded by PlatformAdminRoleGuard
      // with no @RequirePlatformAdminRole metadata is a misconfiguration,
      // never an implicit allow.
      throw new PlatformAdminRoleRequiredException();
    }

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[PLATFORM_ADMIN_ACTOR_KEY] as PlatformAdminActor | undefined;

    if (!actor) {
      await this.auditDenial(null);
      throw new PlatformAdminRoleRequiredException();
    }

    if (!requiredRoles.includes(actor.role)) {
      await this.auditDenial(actor);
      throw new PlatformAdminRoleRequiredException();
    }

    return true;
  }

  private async auditDenial(actor: PlatformAdminActor | null): Promise<void> {
    await this.auditLogWriter.record({
      actorId: actor?.userId ?? null,
      actorType: 'PlatformAdmin',
      action: 'auth.platform_admin_role.denied',
      targetType: 'PlatformAdminRole',
      targetId: null,
      organizationId: null,
      correlationId: null,
      ipAddress: null,
      occurredAt: new Date(),
    });
  }
}
