import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformAdminRoleGuard } from './platform-admin-role.guard';
import { PlatformAdminRoleRequiredException } from '../../domain/exceptions/platform-admin-role-required.exception';
import { PLATFORM_ADMIN_ACTOR_KEY } from '../../application/dto/platform-admin-actor.dto';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { REQUIRE_PLATFORM_ADMIN_ROLE_KEY } from '../decorators/require-platform-admin-role.decorator';
import { AuditLogEntry, AuditLogWriterPort } from '@shared/application/ports/audit-log-writer.port';

class RecordingAuditLogWriter implements AuditLogWriterPort {
  readonly entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

describe('PlatformAdminRoleGuard — ADR-034 §11-12 two-tier RBAC', () => {
  function build(
    requiredRoles: PlatformAdminRole[] | undefined,
    actor: { userId: string; role: PlatformAdminRole } | undefined,
  ) {
    const request: Record<string, unknown> = {};
    if (actor) {
      request[PLATFORM_ADMIN_ACTOR_KEY] = actor;
    }
    const reflector = {
      get: (key: string) => (key === REQUIRE_PLATFORM_ADMIN_ROLE_KEY ? requiredRoles : undefined),
    } as unknown as Reflector;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
    const auditLogWriter = new RecordingAuditLogWriter();
    const guard = new PlatformAdminRoleGuard(reflector, auditLogWriter);
    return { guard, context, auditLogWriter };
  }

  it('allows a PlatformAdmin actor on a route requiring PlatformAdmin', async () => {
    const { guard, context } = build([PlatformAdminRole.PlatformAdmin], {
      userId: 'admin-1',
      role: PlatformAdminRole.PlatformAdmin,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('denies a PlatformSupport actor on a route requiring PlatformAdmin only (read-only, no mutation authority)', async () => {
    const { guard, context, auditLogWriter } = build([PlatformAdminRole.PlatformAdmin], {
      userId: 'support-1',
      role: PlatformAdminRole.PlatformSupport,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(PlatformAdminRoleRequiredException);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'support-1',
      actorType: 'PlatformAdmin',
      action: 'auth.platform_admin_role.denied',
    });
  });

  it('allows a PlatformSupport actor on a route accepting both roles (read endpoints)', async () => {
    const { guard, context } = build(
      [PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport],
      { userId: 'support-1', role: PlatformAdminRole.PlatformSupport },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('fails closed when @RequirePlatformAdminRole metadata is missing (misconfiguration, never an implicit allow)', async () => {
    const { guard, context } = build(undefined, {
      userId: 'admin-1',
      role: PlatformAdminRole.PlatformAdmin,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(PlatformAdminRoleRequiredException);
  });

  it('fails closed when no PlatformAdmin actor is present (misconfigured guard order)', async () => {
    const { guard, context } = build([PlatformAdminRole.PlatformAdmin], undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(PlatformAdminRoleRequiredException);
  });
});
