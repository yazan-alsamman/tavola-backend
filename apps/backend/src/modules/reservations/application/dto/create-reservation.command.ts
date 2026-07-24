import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReservationSource } from '../../domain/enums/reservation.enums';

/**
 * Phase 7.1 (customer-facing, Online source only): `actor` is the base
 * `AuthenticatedActor` union - every actor type carries `userId`
 * (`AuthenticatedActorBase`), and this endpoint is guarded only by
 * `JwtAuthGuard`/`SessionVersionGuard` (no organization/employee-specific
 * guard), mirroring `UsersController`'s own "own resource" precedent.
 *
 * Widened by Phase 7.4 (decision #1/#3): `source` is optional at the
 * transport boundary for backward compatibility with the existing Customer
 * Online flow, but `CreateReservationUseCase` always resolves it to a
 * concrete `ReservationSource` before touching the domain layer - never left
 * undefined past the presentation/application boundary (binding
 * clarification #1). `reservationGuest` is required, and only meaningful,
 * when `source` is `Phone`/`WalkIn` (an Employee actor); a Customer supplying
 * either is rejected before any repository call.
 */
export interface CreateReservationCommand {
  actor: AuthenticatedActor;
  branchId: string;
  tableId: string;
  reservationStartTime: string;
  reservationEndTime?: string;
  guests: number;
  notes?: string | null;
  source?: ReservationSource;
  reservationGuest?: {
    fullName: string;
    countryCode: string;
    phoneNumber: string;
    email?: string | null;
  };
  correlationId?: string;
}
