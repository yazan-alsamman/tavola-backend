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
 * `PlatformAdmin` is deliberately not modeled here (ADR-022 §"Platform
 * Admin Authentication", Phase 2.23 closure, approved decision): Platform
 * Admin authentication uses a genuinely separate JWT issuer/audience/
 * secret and its own guard (`PlatformAdminGuard`) that never runs after
 * `JwtAuthGuard` and never reads `AuthenticatedActor` - see
 * `modules/platform-admin`. Modeling `PlatformAdmin` in this shared,
 * ordinary-pipeline type would blur exactly the isolation boundary this
 * ADR requires.
 */
export type AuthenticatedActor =
  AuthenticatedUserActor | AuthenticatedEmployeeActor | AuthenticatedOrganizationMemberActor;

export const AUTHENTICATED_ACTOR_KEY = 'authenticatedActor';
