import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedActor,
  AUTHENTICATED_ACTOR_KEY,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { CollectingAuditLogWriter } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { OrganizationRoleRequiredException } from '../../domain/exceptions/organization-role-required.exception';
import { RequireOrgRole } from '../decorators/require-org-role.decorator';
import { OrganizationMemberGuard } from './organization-member.guard';

class TestController {
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  protectedHandler() {
    return null;
  }

  unprotectedHandler() {
    return null;
  }
}

describe('OrganizationMemberGuard', () => {
  const reflector = new Reflector();
  const controller = new TestController();

  function createGuard() {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new OrganizationMemberGuard(reflector, auditLogWriter);
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

  const ownerActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: 'org-1',
    orgRole: 'Owner',
    permissionsVersion: 1,
  };

  const staffActor: AuthenticatedActor = {
    ...ownerActor,
    userId: 'user-2',
    orgRole: 'Staff',
  };

  const employeeActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.Employee,
    userId: 'user-3',
    sessionId: 'session-3',
    sessionVersion: 1,
    tokenFamilyId: 'family-3',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    restaurantId: 'restaurant-1',
    branchIds: [],
    permissions: ['restaurants:manage'],
    permissionsVersion: 1,
  };

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId: 'user-4',
    sessionId: 'session-4',
    sessionVersion: 1,
    tokenFamilyId: 'family-4',
  };

  it('allows an OrganizationMember actor holding one of the required roles', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, ownerActor);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('denies an OrganizationMember actor whose role is not in the required set and audits it', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, staffActor);
    await expect(guard.canActivate(context)).rejects.toThrow(OrganizationRoleRequiredException);

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.org_role.denied',
      actorId: 'user-2',
      actorType: 'User',
      targetType: 'OrganizationRole',
      organizationId: 'org-1',
    });
  });

  it('denies an Employee actor - RBAC and org-role authority layers are never combined', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, employeeActor);
    await expect(guard.canActivate(context)).rejects.toThrow(OrganizationRoleRequiredException);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-3',
      actorType: 'User',
      organizationId: 'org-1',
    });
  });

  it('denies a User (Customer) actor', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, userActor);
    await expect(guard.canActivate(context)).rejects.toThrow(OrganizationRoleRequiredException);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-4',
      actorType: 'User',
      organizationId: null,
    });
  });

  it('denies when no authenticated actor is present on the request', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.protectedHandler, undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(OrganizationRoleRequiredException);
    expect(auditLogWriter.entries[0]).toMatchObject({ actorId: null, actorType: 'User' });
  });

  it('fails closed when the handler has no @RequireOrgRole metadata, without auditing a misconfiguration', async () => {
    const { guard, auditLogWriter } = createGuard();
    const context = createContext(controller.unprotectedHandler, ownerActor);
    await expect(guard.canActivate(context)).rejects.toThrow(OrganizationRoleRequiredException);
    expect(auditLogWriter.entries).toHaveLength(0);
  });
});
