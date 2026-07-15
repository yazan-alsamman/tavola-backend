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
import { PermissionDeniedException } from '../../domain/exceptions/permission-denied.exception';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * RBAC enforcement (AUTHORIZATION_ARCHITECTURE.md §6/§8), guard order 4:
 * JwtAuthGuard (identity) -> SessionVersionGuard (session validity) ->
 * PermissionsGuard (this) -> [future BranchScopeGuard/PolicyEngine].
 *
 * Applied selectively via `@UseGuards`, exactly like JwtAuthGuard and
 * SessionVersionGuard today - never registered as a global `APP_GUARD`.
 * Only ever meaningful on a route that also carries `@RequirePermission`.
 *
 * Trusts only `request[AUTHENTICATED_ACTOR_KEY].permissions`, populated
 * exclusively by JwtAuthGuard from a verified, signed JWT
 * (RbacPermissionResolver resolves it at login/refresh) - never from body,
 * query, params, or headers. `permissionsVersion` staleness is intentionally
 * NOT re-checked against the database here: AUTHORIZATION_ARCHITECTURE.md
 * §17 tolerates a JWT's embedded permissions until natural expiry (<=15 min)
 * or the next refresh, which always re-resolves - this guard's only job is
 * comparing the already-resolved slug set.
 *
 * Phase 2.18: audits every real denial (`auth.permission.denied`) - not the
 * missing-`@RequirePermission`-metadata misconfiguration case, which is a
 * server coding bug, not a client security event.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<string | undefined>(
      REQUIRE_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!requiredPermission) {
      // Fail closed (AUTHORIZATION_ARCHITECTURE.md §1.1 "default deny"): a
      // route guarded by PermissionsGuard with no @RequirePermission
      // metadata is a misconfiguration, never an implicit allow.
      throw new PermissionDeniedException();
    }

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[AUTHENTICATED_ACTOR_KEY] as AuthenticatedActor | undefined;

    if (!actor || !hasResolvedPermissions(actor)) {
      // Missing actor (JwtAuthGuard did not run) and actor types with no
      // `permissions` array (User, OrganizationMember - RBAC slugs are an
      // Employee-only concept per §2.1/§14: "these layers must never be
      // conflated") are both structurally denied here, never coerced into
      // an authentication failure being reinterpreted as an authorization pass.
      await this.auditDenial(actor, requiredPermission);
      throw new PermissionDeniedException(requiredPermission);
    }

    if (!actor.permissions.includes(requiredPermission)) {
      await this.auditDenial(actor, requiredPermission);
      throw new PermissionDeniedException(requiredPermission);
    }

    return true;
  }

  private async auditDenial(
    actor: AuthenticatedActor | undefined,
    requiredPermission: string,
  ): Promise<void> {
    await this.auditLogWriter.record({
      actorId: actor?.userId ?? null,
      actorType: actor?.actorType === 'Employee' ? 'Employee' : 'User',
      action: 'auth.permission.denied',
      targetType: 'Permission',
      targetId: requiredPermission,
      organizationId: actor && 'organizationId' in actor ? (actor.organizationId as string) : null,
      correlationId: null,
      ipAddress: null,
      occurredAt: new Date(),
    });
  }
}

function hasResolvedPermissions(
  actor: AuthenticatedActor,
): actor is AuthenticatedActor & { permissions: string[] } {
  return 'permissions' in actor && Array.isArray((actor as { permissions?: unknown }).permissions);
}
