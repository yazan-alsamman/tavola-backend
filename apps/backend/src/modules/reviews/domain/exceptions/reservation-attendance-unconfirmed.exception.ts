import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-048: a reservation the auto-close sweep completed was never confirmed
 * by staff, so the guest may not have come. Only a reservation staff marked
 * Completed can be reviewed.
 */
export class ReservationAttendanceUnconfirmedException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super(
      'This reservation was closed automatically, so the visit was not confirmed and it cannot be reviewed.',
      400,
    );
  }
}
