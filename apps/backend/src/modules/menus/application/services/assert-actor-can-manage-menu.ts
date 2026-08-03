import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';

/** ADR-031 decision #8: new permission slug, `<resource>:<action>` convention (AUTHORIZATION_ARCHITECTURE.md). */
export const MENU_MANAGE_PERMISSION = 'menu:manage';

/**
 * Phase 18 (Menu Management, ADR-031 decision #8). Every management route
 * uses only `JwtAuthGuard` + `SessionVersionGuard` (no `OrganizationMemberGuard`/
 * `PermissionsGuard`, either of which would structurally deny one of the two
 * legitimate actor types) - authorization is resolved here, use-case-level
 * branching, the same pattern `assertActorCanViewAnalytics` (ADR-028) and
 * `assertActorCanManageTables` (ADR-026) already established.
 *
 * `restaurantId` must already have been resolved through the tenant-scoped
 * `RestaurantRepository` (so a cross-organization restaurantId has already
 * collapsed to `RestaurantNotFoundException` before this function runs). An
 * `OrganizationMember` must further hold `Owner`/`Admin` role (full access,
 * no slug needed, ADR-031 decision #8). An `Employee` must belong to exactly
 * this Restaurant (`AuthenticatedEmployeeActor.restaurantId` - Menu is
 * Restaurant-scoped, not Branch-scoped, so no branch-assignment check
 * applies here) and hold `menu:manage`. A `User` (Customer) actor has no
 * legitimate claim to Menu management at all.
 *
 * An Employee belonging to a *different* Restaurant collapses to
 * `RestaurantNotFoundException` (404, IDOR-safe) rather than 403, matching
 * every other module's "unknown/cross-tenant collapse to the same response"
 * convention.
 */
export function assertActorCanManageMenu(actor: AuthenticatedActor, restaurantId: string): void {
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
    if (!actor.permissions.includes(MENU_MANAGE_PERMISSION)) {
      throw new PermissionDeniedException(MENU_MANAGE_PERMISSION);
    }
    return;
  }

  throw new PermissionDeniedException();
}

/** The id to attribute Menu domain events/audit rows to - the Employee's own id for an Employee actor, the OrganizationMember's own `userId` otherwise (matches `resolveTableManagementActorId`'s ADR-026 precedent). */
export function resolveMenuManagementActorId(actor: AuthenticatedActor): string {
  return actor.actorType === AccessTokenActorType.Employee ? actor.employeeId : actor.userId;
}
