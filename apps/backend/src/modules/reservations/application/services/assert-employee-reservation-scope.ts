import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
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
