import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';

/**
 * Phase 7.2 - shared by `ApproveReservationUseCase`/`RejectReservationUseCase`.
 * A reservation belonging to a different restaurant collapses to 404
 * (IDOR-safe, matching every other module's own "unknown/cross-tenant
 * collapse to the same response" precedent) rather than leaking existence
 * via a 403. A branch-scope mismatch WITHIN the caller's own restaurant is a
 * genuine authorization rule (`EmployeeBranchNotAssignedException`, 403) -
 * `AuthenticatedEmployeeActor.branchIds` is already resolved at
 * login/refresh (empty = restaurant-wide scope, matching
 * `Employee.assertBranchScope()`'s own domain-entity semantics), so no
 * additional repository lookup is required here.
 */
export function assertEmployeeCanActOnReservation(
  actor: AuthenticatedEmployeeActor,
  reservation: Reservation,
): void {
  if (reservation.restaurantId.value !== actor.restaurantId) {
    throw new ReservationNotFoundException();
  }
  if (actor.branchIds.length > 0 && !actor.branchIds.includes(reservation.branchId.value)) {
    throw new EmployeeBranchNotAssignedException();
  }
}

/**
 * Phase 7.4 decision #3 - the Create-time counterpart of
 * `assertEmployeeCanActOnReservation` above, for the one case where no
 * `Reservation` row exists yet to check against: an Employee creating a
 * Phone/WalkIn reservation. Checked against the already-resolved target
 * Branch's own `restaurantId`/`branchId` (Create Reservation already loads
 * the Branch before this point). A cross-restaurant Branch collapses to
 * `BranchNotFoundException` (404, the same response `CreateReservationUseCase`
 * already gives a genuinely-unknown branch) rather than a Reservation-shaped
 * exception, since the resource being scope-checked here is the Branch, not
 * a not-yet-created Reservation - same IDOR-safe "unknown and no-access look
 * identical" principle as every other check in this module. Order (branch
 * scope -> permission) mirrors every other Employee-actor reservation check.
 */
export function assertEmployeeCanCreateReservation(
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
