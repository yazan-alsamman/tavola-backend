import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Phase 7.1 (customer-facing, Online source only): `actor` is the base
 * `AuthenticatedActor` union - every actor type carries `userId`
 * (`AuthenticatedActorBase`), and this endpoint is guarded only by
 * `JwtAuthGuard`/`SessionVersionGuard` (no organization/employee-specific
 * guard), mirroring `UsersController`'s own "own resource" precedent.
 */
export interface CreateReservationCommand {
  actor: AuthenticatedActor;
  branchId: string;
  tableId: string;
  reservationStartTime: string;
  reservationEndTime?: string;
  guests: number;
  notes?: string | null;
  correlationId?: string;
}
