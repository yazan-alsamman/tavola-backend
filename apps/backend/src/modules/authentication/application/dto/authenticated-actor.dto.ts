import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export interface AuthenticatedActorBase {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  tokenFamilyId: string;
}

export interface AuthenticatedUserActor extends AuthenticatedActorBase {
  actorType: AccessTokenActorType.User;
}

export interface AuthenticatedEmployeeActor extends AuthenticatedActorBase {
  actorType: AccessTokenActorType.Employee;
  employeeId: string;
  organizationId: string;
  restaurantId: string;
  branchIds: string[];
  permissions: string[];
  permissionsVersion: number;
}

export interface AuthenticatedOrganizationMemberActor extends AuthenticatedActorBase {
  actorType: AccessTokenActorType.OrganizationMember;
  organizationId: string;
  orgRole: string;
  permissionsVersion: number;
}

/**
 * `PlatformAdmin` is intentionally not modeled here yet: nothing in the
 * codebase can authenticate as one (AUTHENTICATION_ARCHITECTURE.md §5.2 notes
 * it uses a separate issuer/audience entirely), so a request actor shape for
 * it would be untestable speculation. Add it when platform-admin
 * authentication is actually built.
 */
export type AuthenticatedActor =
  AuthenticatedUserActor | AuthenticatedEmployeeActor | AuthenticatedOrganizationMemberActor;

export const AUTHENTICATED_ACTOR_KEY = 'authenticatedActor';
