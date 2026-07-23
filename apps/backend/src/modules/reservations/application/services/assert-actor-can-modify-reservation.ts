import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';

/**
 * Phase 7.3 - shared by `CancelReservationUseCase`/`RescheduleReservationUseCase`,
 * the two Domain Actions reachable by both the reservation's own Customer
 * and a branch-scoped Employee on the same route (architecture frozen,
 * TASKS.md's Phase 7.3 decision note item 8) - resolved entirely as
 * use-case-level actor branching, not new guard composition. The route's own
 * guard chain is `JwtAuthGuard` + `SessionVersionGuard` only (no
 * `PermissionsGuard`, which would otherwise structurally deny every Customer
 * actor).
 *
 * A `User` actor must own the reservation - any mismatch collapses to
 * `ReservationNotFoundException` (404), never a 403, so a guessed id never
 * leaks whether a reservation exists (IDOR-safe). An `Employee` actor must
 * belong to the same restaurant (else 404, same IDOR-safe collapse used
 * everywhere else), pass branch scope (else `EmployeeBranchNotAssignedException`),
 * and hold `employeePermission` (else `PermissionDeniedException`). Any other
 * actor type (`OrganizationMember`) has no legitimate claim to a Reservation
 * resource at all and is denied outright.
 */
export function assertActorCanModifyReservation(
  actor: AuthenticatedActor,
  reservation: Reservation,
  employeePermission: string,
): void {
  if (actor.actorType === AccessTokenActorType.User) {
    if (reservation.userId?.value !== actor.userId) {
      throw new ReservationNotFoundException();
    }
    return;
  }

  if (actor.actorType === AccessTokenActorType.Employee) {
    if (reservation.restaurantId.value !== actor.restaurantId) {
      throw new ReservationNotFoundException();
    }
    if (actor.branchIds.length > 0 && !actor.branchIds.includes(reservation.branchId.value)) {
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
 * Resolves the id to attribute an actor-driven Reservation event/history
 * row to - the Employee's own id for an Employee actor, the User's own id
 * otherwise. Only ever called after `assertActorCanModifyReservation` has
 * already confirmed the actor is one of these two types.
 */
export function resolveActingId(actor: AuthenticatedActor): string {
  return actor.actorType === AccessTokenActorType.Employee ? actor.employeeId : actor.userId;
}
