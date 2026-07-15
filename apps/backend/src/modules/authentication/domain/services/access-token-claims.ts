export enum AccessTokenActorType {
  User = 'User',
  Employee = 'Employee',
  OrganizationMember = 'OrganizationMember',
  PlatformAdmin = 'PlatformAdmin',
}

interface AccessTokenClaimBase {
  sub: string;
  actorType: AccessTokenActorType;
  sessionId: string;
  sessionVersion: number;
  tokenFamilyId: string;
  iat?: number;
  exp?: number;
}

export interface UserAccessTokenClaims extends AccessTokenClaimBase {
  actorType: AccessTokenActorType.User;
}

export interface EmployeeAccessTokenClaims extends AccessTokenClaimBase {
  actorType: AccessTokenActorType.Employee;
  employeeId: string;
  organizationId: string;
  restaurantId: string;
  branchIds: string[];
  permissions: string[];
  permissionsVersion: number;
}

export interface OrganizationMemberAccessTokenClaims extends AccessTokenClaimBase {
  actorType: AccessTokenActorType.OrganizationMember;
  organizationId: string;
  orgRole: string;
  permissionsVersion: number;
}

export interface PlatformAdminAccessTokenClaims extends AccessTokenClaimBase {
  actorType: AccessTokenActorType.PlatformAdmin;
}

export type AccessTokenClaims =
  | UserAccessTokenClaims
  | EmployeeAccessTokenClaims
  | OrganizationMemberAccessTokenClaims
  | PlatformAdminAccessTokenClaims;
