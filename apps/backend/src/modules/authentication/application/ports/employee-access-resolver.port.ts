import { UserId } from '@shared/domain/value-objects/identifiers.vo';

export interface EmployeeAccessSnapshot {
  employeeId: string;
  organizationId: string;
  restaurantId: string;
  branchIds: string[];
  permissions: string[];
  permissionsVersion: number;
}

/**
 * Owned by Authentication (Dependency Inversion): Login/Refresh need to know
 * whether the authenticating user is also an active Employee, and if so with
 * which resolved RBAC permissions, in order to pick the right JWT claim shape
 * (AUTHENTICATION_ARCHITECTURE.md §5.2). The concrete resolver - which calls
 * the domain `PermissionResolver` - lives in the `authorization` module
 * (AUTHORIZATION_ARCHITECTURE.md §1.3) and is bound to this token there, so
 * Authentication never depends on Authorization's internals directly.
 */
export interface EmployeeAccessResolverPort {
  resolveForUserId(userId: UserId): Promise<EmployeeAccessSnapshot | null>;
}

export const EMPLOYEE_ACCESS_RESOLVER = Symbol('EMPLOYEE_ACCESS_RESOLVER');
