import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { OrganizationRoleRequiredException } from '../../domain/exceptions/organization-role-required.exception';
import { REQUIRE_ORG_ROLE_KEY } from '../decorators/require-org-role.decorator';

/**
 * Organization-administrative authorization (AUTHORIZATION_ARCHITECTURE.md
 * §2.1/§8/§13), the counterpart to `PermissionsGuard` for the
 * `OrganizationMember` actor type - never combined with it on the same
 * route (§14 "these layers must never be conflated").
 *
 * Thin by design, matching `PermissionsGuard`: reads `orgRole` already
 * embedded in the verified JWT (populated at login from `OrganizationMember`,
 * AUTHENTICATION_ARCHITECTURE.md §5.2), no database round-trip. Fail-closed:
 * missing `@RequireOrgRole` metadata, a non-`OrganizationMember` actor, or a
 * role outside the declared allow-list are all denied, never an implicit
 * pass-through.
 */
@Injectable()
export class OrganizationMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<OrganizationMemberRole[] | undefined>(
      REQUIRE_ORG_ROLE_KEY,
      context.getHandler(),
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      // Fail closed (default deny): a route guarded by OrganizationMemberGuard
      // with no @RequireOrgRole metadata is a misconfiguration, never an
      // implicit allow.
      throw new OrganizationRoleRequiredException();
    }

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[AUTHENTICATED_ACTOR_KEY] as AuthenticatedActor | undefined;

    if (!actor || actor.actorType !== AccessTokenActorType.OrganizationMember) {
      await this.auditDenial(actor);
      throw new OrganizationRoleRequiredException();
    }

    if (!(requiredRoles as string[]).includes(actor.orgRole)) {
      await this.auditDenial(actor);
      throw new OrganizationRoleRequiredException();
    }

    return true;
  }

  private async auditDenial(actor: AuthenticatedActor | undefined): Promise<void> {
    await this.auditLogWriter.record({
      actorId: actor?.userId ?? null,
      // AuditActorType has no 'OrganizationMember' value - an OrganizationMember's
      // underlying identity is always a `Users` row (same as PermissionsGuard's
      // own denial audit treats a non-Employee actor as 'User').
      actorType: 'User',
      action: 'auth.org_role.denied',
      targetType: 'OrganizationRole',
      targetId: null,
      organizationId: actor && 'organizationId' in actor ? (actor.organizationId as string) : null,
      correlationId: null,
      ipAddress: null,
      occurredAt: new Date(),
    });
  }
}
