import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';

/** ADR-028 Decision #5: no new permission slug - reuses the existing, seeded `reports:view`. */
export const REPORTS_VIEW_PERMISSION = 'reports:view';

/**
 * Phase 14 (Analytics, ADR-028 Decision #5). Every Analytics route uses only
 * `JwtAuthGuard` + `SessionVersionGuard` (no `OrganizationMemberGuard`/
 * `PermissionsGuard`, which would each structurally deny one of the two
 * legitimate actor types) - authorization is resolved here, use-case-level
 * branching, the same pattern `assertActorCanManageTables` (ADR-026) and
 * `assertEmployeeCanActOnReservation` (Phase 7.3) already established.
 *
 * `restaurantId` must already have been resolved through the tenant-scoped
 * `RestaurantRepository` (so a cross-organization restaurantId has already
 * collapsed to `RestaurantNotFoundException` before this function runs - an
 * `OrganizationMember` reaching this point is therefore already confirmed to
 * belong to the owning organization). An `OrganizationMember` must further
 * hold `Owner`/`Admin` role. An `Employee` must belong to exactly this
 * Restaurant (`AuthenticatedEmployeeActor.restaurantId`), hold `reports:view`,
 * and - only when `branchId` is provided (Branch-scoped routes) - pass
 * existing branch-assignment scope (empty `branchIds` = restaurant-wide
 * scope, matching every other Employee dual-actor check in this codebase). A
 * `User` (Customer) actor has no legitimate claim to Analytics at all.
 *
 * An Employee belonging to a *different* Restaurant collapses to
 * `RestaurantNotFoundException` (404, IDOR-safe) rather than 403, matching
 * every other module's "unknown/cross-tenant collapse to the same response"
 * convention; a same-Restaurant Employee lacking the required
 * branch-assignment or permission gets the more specific 403.
 */
export function assertActorCanViewAnalytics(
  actor: AuthenticatedActor,
  restaurantId: string,
  branchId: BranchId | null,
): void {
  if (actor.actorType === AccessTokenActorType.OrganizationMember) {
    if (
      actor.orgRole !== OrganizationMemberRole.Owner &&
      actor.orgRole !== OrganizationMemberRole.Admin
    ) {
      throw new PermissionDeniedException();
    }
    return;
  }

  if (actor.actorType === AccessTokenActorType.Employee) {
    if (actor.restaurantId !== restaurantId) {
      throw new RestaurantNotFoundException();
    }
    if (
      branchId !== null &&
      actor.branchIds.length > 0 &&
      !actor.branchIds.includes(branchId.value)
    ) {
      throw new EmployeeBranchNotAssignedException();
    }
    if (!actor.permissions.includes(REPORTS_VIEW_PERMISSION)) {
      throw new PermissionDeniedException(REPORTS_VIEW_PERMISSION);
    }
    return;
  }

  throw new PermissionDeniedException();
}

/**
 * ADR-028 Decision #6: Organization-scope aggregation is Owner/Admin only -
 * an Employee is always scoped to exactly one Restaurant
 * (`AuthenticatedEmployeeActor.restaurantId`), so there is no legitimate
 * Employee path to an Organization-wide aggregate at all.
 */
export function assertActorCanViewOrganizationAnalytics(actor: AuthenticatedActor): void {
  if (
    actor.actorType !== AccessTokenActorType.OrganizationMember ||
    (actor.orgRole !== OrganizationMemberRole.Owner &&
      actor.orgRole !== OrganizationMemberRole.Admin)
  ) {
    throw new PermissionDeniedException();
  }
}

/**
 * The Branch-id filter to apply to an aggregate query when no specific
 * `branchId` was requested (Restaurant/Organization-scope routes): `null`
 * means unrestricted (Owner/Admin, or an Employee with restaurant-wide
 * scope); a non-null array restricts the aggregate to exactly the Employee's
 * assigned branches, so a branch-restricted Employee's restaurant-wide
 * summary never includes a branch they are not assigned to.
 */
export function resolveEffectiveBranchIdFilter(actor: AuthenticatedActor): string[] | null {
  if (actor.actorType === AccessTokenActorType.Employee && actor.branchIds.length > 0) {
    return actor.branchIds;
  }
  return null;
}
