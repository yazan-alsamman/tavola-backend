import { PermissionSlug } from '@shared/domain/value-objects/permission-slug.vo';
import { AuthorizationDecisionVo } from '../value-objects/authorization-decision.vo';
import { ScopeContext } from '../value-objects/scope-context.vo';
import { Employee } from '../entities/employee.entity';
import { PermissionResolver } from './permission-resolver';
import { PermissionDeniedException } from '../exceptions/permission-denied.exception';

export interface AuthorizationActor {
  readonly actorType: 'User' | 'Employee' | 'OrganizationMember' | 'PlatformAdmin';
  readonly userId: string;
  readonly employee?: Employee;
  readonly effectivePermissions: Set<string>;
}

export interface AuthorizationPolicyContext {
  readonly scope: ScopeContext;
  readonly resourceOwnerId?: string;
}

export interface AuthorizationPolicy {
  authorize(
    actor: AuthorizationActor,
    action: PermissionSlug,
    context: AuthorizationPolicyContext,
  ): AuthorizationDecisionVo;
}

export class DefaultAuthorizationPolicy implements AuthorizationPolicy {
  authorize(
    actor: AuthorizationActor,
    action: PermissionSlug,
    context: AuthorizationPolicyContext,
  ): AuthorizationDecisionVo {
    if (actor.actorType === 'User' && context.resourceOwnerId === actor.userId) {
      return AuthorizationDecisionVo.allow();
    }

    if (actor.actorType === 'Employee' && actor.employee) {
      try {
        actor.employee.canAuthenticate();
        if (context.scope.branchId) {
          actor.employee.assertBranchScope(context.scope.branchId);
        }
        PermissionResolver.assertPermission(actor.effectivePermissions, action);
        return AuthorizationDecisionVo.allow();
      } catch (error) {
        if (error instanceof PermissionDeniedException) {
          return AuthorizationDecisionVo.deny(error.message, error.code);
        }
        throw error;
      }
    }

    try {
      PermissionResolver.assertPermission(actor.effectivePermissions, action);
      return AuthorizationDecisionVo.allow();
    } catch (error) {
      if (error instanceof PermissionDeniedException) {
        return AuthorizationDecisionVo.deny(error.message, error.code);
      }
      throw error;
    }
  }
}

export class AuthorizationPolicyService {
  static assertAllowed(
    policy: AuthorizationPolicy,
    actor: AuthorizationActor,
    action: PermissionSlug,
    context: AuthorizationPolicyContext,
  ): void {
    const decision = policy.authorize(actor, action, context);
    if (!decision.isAllowed()) {
      const denied = decision.decision;
      if (!denied.allowed) {
        throw new PermissionDeniedException(action.value);
      }
    }
  }
}
