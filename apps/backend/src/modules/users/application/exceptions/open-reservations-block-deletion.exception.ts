import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 20.X (ADR-014 execution) - `RequestAccountDeletionUseCase`'s open-
 * reservations gate. ADR-014 forbids modifying Reservation rows during
 * anonymization, so a `Pending`/`Approved` reservation the restaurant is
 * still expecting a guest for can't be silently cancelled as a side effect
 * of an unrelated action - the customer must cancel it themselves first via
 * the existing self-service cancel-reservation flow, then retry deletion.
 */
export class OpenReservationsBlockDeletionException extends DomainException {
  public readonly code = 'OPEN_RESERVATIONS_BLOCK_DELETION';

  constructor() {
    super(
      'Account deletion is blocked while you have upcoming reservations. Cancel them first, then try again.',
      409,
    );
  }
}
