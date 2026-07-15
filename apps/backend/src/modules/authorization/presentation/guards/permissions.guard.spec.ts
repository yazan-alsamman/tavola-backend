import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedActor,
  AUTHENTICATED_ACTOR_KEY,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CollectingAuditLogWriter } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { PermissionDeniedException } from '../../domain/exceptions/permission-denied.exception';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { PermissionsGuard } from './permissions.guard';

class TestController {
  @RequirePermission('reservations:approve')
  protectedHandler() {
    return null;
  }

  unprotectedHandler() {
    return null;
  }
}

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const controller = new TestController();

  function createGuard() {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new PermissionsGuard(reflector, auditLogWriter);
    return { guard, auditLogWriter };
  }

  function createContext(
    handler: () => unknown,
    actor: AuthenticatedActor | undefined,
  ): ExecutionContext {
    const request: Record<string, unknown> = actor ? { [AUTHENTICATED_ACTOR_KEY]: actor } : {};
    return {
      getHandler: () => handler,
      getClass: () => TestController,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  const employeeActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.Employee,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    restaurantId: 'restaurant-1',
    branchIds: [],
    permissions: ['reservations:approve', 'tables:manage'],
    permissionsVersion: 1,
  };

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId: 'user-2',
    sessionId: 'session-2',
    sessionVersion: 1,
    tokenFamilyId: 'family-2',
  };

  const organizationMemberActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'user-3',
    sessionId: 'session-3',
    sessionVersion: 1,
    tokenFamilyId: 'family-3',
    organizationId: 'org-1',
    orgRole: 'Owner',
    permissionsVersion: 1,
  };

  it('allows an Employee actor holding the exact required permission', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, employeeActor);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('denies an Employee actor lacking the required permission and audits it', async () => {
    const { guard, auditLogWriter } = createGuard();
    const restrictedEmployee: AuthenticatedActor = {
      ...employeeActor,
      permissions: ['tables:manage'],
    };
    const context = createContext(controller.protectedHandler, restrictedEmployee);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.permission.denied',
      actorId: 'user-1',
      actorType: 'Employee',
      targetType: 'Permission',
      targetId: 'reservations:approve',
      organizationId: 'org-1',
    });
  });

  it('denies an Employee actor with an empty permissions array', async () => {
    const { guard, auditLogWriter } = createGuard();
    const noPermissionsEmployee: AuthenticatedActor = { ...employeeActor, permissions: [] };
    const context = createContext(controller.protectedHandler, noPermissionsEmployee);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
    expect(auditLogWriter.entries).toHaveLength(1);
  });

  it('denies a User (Customer) actor - RBAC slugs are an Employee-only concept', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, userActor);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.permission.denied',
      actorId: 'user-2',
      actorType: 'User',
      organizationId: null,
    });
  });

  it('denies an OrganizationMember actor - org role is a separate authority layer', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, organizationMemberActor);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-3',
      actorType: 'User',
      organizationId: 'org-1',
    });
  });

  it('denies when no authenticated actor is present on the request', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
    expect(auditLogWriter.entries[0]).toMatchObject({ actorId: null, actorType: 'User' });
  });

  it('fails closed when the handler has no @RequirePermission metadata, without auditing a misconfiguration', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.unprotectedHandler, employeeActor);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('does not match by substring', async () => {
    const { guard } = createGuard();
    class SubstringController {
      @RequirePermission('reservations:approve')
      handler() {
        return null;
      }
    }
    const substringEmployee: AuthenticatedActor = {
      ...employeeActor,
      permissions: ['reservations:approved-extended'],
    };
    const context = createContext(new SubstringController().handler, substringEmployee);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
  });

  it('does not match case-insensitively', async () => {
    const { guard } = createGuard();
    const upperCaseEmployee: AuthenticatedActor = {
      ...employeeActor,
      permissions: ['RESERVATIONS:APPROVE'],
    };
    const context = createContext(controller.protectedHandler, upperCaseEmployee);
    await expect(guard.canActivate(context)).rejects.toThrow(PermissionDeniedException);
  });

  it('ignores duplicate permission entries and still allows once matched', async () => {
    const { guard, auditLogWriter } = createGuard();
    const duplicatedEmployee: AuthenticatedActor = {
      ...employeeActor,
      permissions: ['reservations:approve', 'reservations:approve', 'tables:manage'],
    };
    const context = createContext(controller.protectedHandler, duplicatedEmployee);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auditLogWriter.entries).toHaveLength(0);
  });
});
