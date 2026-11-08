import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { RestaurantRepository } from '@modules/restaurants/domain/repositories/restaurant.repository';
import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistEntryNotFoundException } from '../../domain/exceptions/waitlist-entry-not-found.exception';

/**
 * Phase 7.5 architecture freeze item 8 (actors/authorization) - mirrors
 * `assertActorCanModifyReservation` (Phase 7.3 precedent) exactly. Reachable
 * from `POST /waitlist/:id/cancel` (dual-actor, no `PermissionsGuard`). A
 * `User` actor must own the entry (else 404, IDOR-safe); an `Employee` actor
 * must belong to the same restaurant, pass branch scope, and hold
 * `reservations:waitlist`.
 */
export function assertActorCanModifyWaitlistEntry(
  actor: AuthenticatedActor,
  entry: ReservationWaitlistEntry,
  employeePermission: string,
): void {
  if (actor.actorType === AccessTokenActorType.User) {
    if (entry.userId?.value !== actor.userId) {
      throw new WaitlistEntryNotFoundException();
    }
    return;
  }

  if (actor.actorType === AccessTokenActorType.Employee) {
    if (entry.restaurantId.value !== actor.restaurantId) {
      throw new WaitlistEntryNotFoundException();
    }
    if (actor.branchIds.length > 0 && !actor.branchIds.includes(entry.branchId.value)) {
      throw new EmployeeBranchNotAssignedException();
    }
    if (!actor.permissions.includes(employeePermission)) {
      throw new PermissionDeniedException(employeePermission);
    }
    return;
  }

  throw new PermissionDeniedException();
}

/**
 * `POST /waitlist/:id/promote`'s own guard - mirrors
 * `assertEmployeeCanActOnReservation` (used by Approve/Reject) exactly: only
 * branch/tenant scope, no permission check here - the route's own
 * `PermissionsGuard` + `@RequirePermission('reservations:waitlist')` already
 * enforces the permission (Phase 7.5 freeze item 8: Customers "may not
 * manually Promote" at all, so this function is never reachable by a
 * non-Employee actor - the route itself has no dual-actor path).
 */
export function assertEmployeeCanActOnWaitlistEntry(
  actor: AuthenticatedEmployeeActor,
  entry: ReservationWaitlistEntry,
): void {
  if (entry.restaurantId.value !== actor.restaurantId) {
    throw new WaitlistEntryNotFoundException();
  }
  if (actor.branchIds.length > 0 && !actor.branchIds.includes(entry.branchId.value)) {
    throw new EmployeeBranchNotAssignedException();
  }
}

/**
 * The Join-time counterpart, mirroring `assertEmployeeCanCreateReservation`
 * exactly - checked against the already-resolved target Branch (Join Waitlist
 * already loads the Branch before this point) since no `ReservationWaitlistEntry`
 * row exists yet to check against.
 */
export function assertEmployeeCanJoinWaitlist(
  actor: AuthenticatedEmployeeActor,
  restaurantId: RestaurantId,
  branchId: BranchId,
  employeePermission: string,
): void {
  if (restaurantId.value !== actor.restaurantId) {
    throw new BranchNotFoundException();
  }
  if (actor.branchIds.length > 0 && !actor.branchIds.includes(branchId.value)) {
    throw new EmployeeBranchNotAssignedException();
  }
  if (!actor.permissions.includes(employeePermission)) {
    throw new PermissionDeniedException(employeePermission);
  }
}

/**
 * Resolves the id to attribute an actor-driven Waitlist event to - the
 * Employee's own id for an Employee actor, the User's own id otherwise. Only
 * ever called after `assertActorCanModifyWaitlistEntry` has already
 * confirmed the actor is one of these two types.
 */
/**
 * Staff actions on a waitlist entry (promote, staff-side cancel). The
 * Owner/Admin of the organization that owns the restaurant may act without an
 * Employee permission slug - exactly like `assertActorCanOperateReservation`
 * for reservations. `PermissionsGuard` cannot express this: it denies every
 * OrganizationMember because they carry no permission list. An Employee still
 * needs branch scope and the slug. The restaurant lookup is tenant-scoped, so
 * a caller from another organization gets the same 404 as a missing entry.
 */
export async function assertStaffCanOperateWaitlistEntry(
  actor: AuthenticatedActor,
  entry: ReservationWaitlistEntry,
  employeePermission: string,
  restaurantRepository: RestaurantRepository,
): Promise<void> {
  if (actor.actorType === AccessTokenActorType.OrganizationMember) {
    await assertOrganizationAdminOwnsRestaurant(
      actor,
      entry.restaurantId,
      employeePermission,
      restaurantRepository,
      () => new WaitlistEntryNotFoundException(),
    );
    return;
  }

  if (actor.actorType !== AccessTokenActorType.Employee) {
    throw new PermissionDeniedException(employeePermission);
  }

  assertEmployeeCanActOnWaitlistEntry(actor, entry);
  if (!actor.permissions.includes(employeePermission)) {
    throw new PermissionDeniedException(employeePermission);
  }
}

/**
 * The actor is the Owner/Admin of the organization that owns `restaurantId`.
 * `RestaurantRepository.findById` is tenant-scoped, so a restaurant of another
 * organization is invisible and collapses to `notFound()` (IDOR-safe).
 */
export async function assertOrganizationAdminOwnsRestaurant(
  actor: AuthenticatedActor,
  restaurantId: RestaurantId,
  permissionForDenial: string,
  restaurantRepository: RestaurantRepository,
  notFound: () => Error,
): Promise<void> {
  if (
    actor.actorType !== AccessTokenActorType.OrganizationMember ||
    (actor.orgRole !== OrganizationMemberRole.Owner &&
      actor.orgRole !== OrganizationMemberRole.Admin)
  ) {
    throw new PermissionDeniedException(permissionForDenial);
  }
  const restaurant = await restaurantRepository.findById(restaurantId);
  if (restaurant === null) {
    throw notFound();
  }
}

export function resolveWaitlistActingId(actor: AuthenticatedActor): string {
  return actor.actorType === AccessTokenActorType.Employee ? actor.employeeId : actor.userId;
}

/**
 * The `'User' | 'Employee'` counterpart to `resolveWaitlistActingId`, carried
 * explicitly on `WaitlistEntryCancelledEvent` so audit attribution never has
 * to guess from the entry's own ownership (see that event's own doc
 * comment).
 */
export function resolveWaitlistActingActorType(actor: AuthenticatedActor): 'User' | 'Employee' {
  return actor.actorType === AccessTokenActorType.Employee ? 'Employee' : 'User';
}
