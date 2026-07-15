import {
  AccessTokenActorType,
  AccessTokenClaims,
  EmployeeAccessTokenClaims,
  OrganizationMemberAccessTokenClaims,
  UserAccessTokenClaims,
} from '../../domain/services/access-token-claims';
import { LoginOrganizationSnapshot } from '../ports/login-organization-reader.port';
import { EmployeeAccessSnapshot } from '../ports/employee-access-resolver.port';

export interface AccessTokenClaimsInput {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  tokenFamilyId: string;
  /** `Users.permissionsVersion` - authoritative for the User and OrganizationMember actor branches. */
  userPermissionsVersion: number;
  organization: LoginOrganizationSnapshot | null;
  employeeAccess: EmployeeAccessSnapshot | null;
}

export interface ResolvedAccessTokenClaims {
  claims: AccessTokenClaims;
  actorType: AccessTokenActorType;
  permissionsVersion: number;
}

/**
 * Single source of truth for picking the JWT claim shape at login/refresh
 * time (AUTHENTICATION_ARCHITECTURE.md §5.2), shared by `LoginUseCase` and
 * `RefreshSessionUseCase` so the two never drift.
 *
 * Precedence when a user holds more than one of these records simultaneously
 * - allowed per §2.2 ("Owner may also hold Employee record") - is
 * Employee > OrganizationMember > User: Employee is the more operationally
 * specific actor, and is the only one `PermissionResolver`'s RBAC formula
 * (AUTHORIZATION_ARCHITECTURE.md §3.2) actually applies to. An Owner who is
 * also an Employee still surfaces their org-admin role through the
 * informational `organization` snapshot already carried on the login/refresh
 * result (see `LoginResult.organization`), independent of JWT `actorType`.
 * This precedence is currently unreachable in production - no use case yet
 * creates `Employee` rows - and is proven by a dedicated unit test rather
 * than left implicit.
 */
export class AccessTokenClaimsBuilder {
  static build(input: AccessTokenClaimsInput): ResolvedAccessTokenClaims {
    const base = {
      sub: input.userId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      tokenFamilyId: input.tokenFamilyId,
    };

    if (input.employeeAccess !== null) {
      const permissionsVersion = input.employeeAccess.permissionsVersion;
      const claims: EmployeeAccessTokenClaims = {
        ...base,
        actorType: AccessTokenActorType.Employee,
        employeeId: input.employeeAccess.employeeId,
        organizationId: input.employeeAccess.organizationId,
        restaurantId: input.employeeAccess.restaurantId,
        branchIds: input.employeeAccess.branchIds,
        permissions: input.employeeAccess.permissions,
        permissionsVersion,
      };
      return { claims, actorType: AccessTokenActorType.Employee, permissionsVersion };
    }

    if (input.organization !== null) {
      const permissionsVersion = input.userPermissionsVersion;
      const claims: OrganizationMemberAccessTokenClaims = {
        ...base,
        actorType: AccessTokenActorType.OrganizationMember,
        organizationId: input.organization.organizationId,
        orgRole: input.organization.role,
        permissionsVersion,
      };
      return { claims, actorType: AccessTokenActorType.OrganizationMember, permissionsVersion };
    }

    const claims: UserAccessTokenClaims = { ...base, actorType: AccessTokenActorType.User };
    return {
      claims,
      actorType: AccessTokenActorType.User,
      permissionsVersion: input.userPermissionsVersion,
    };
  }
}
