import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ReservationNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Reservation not found.', 404);
  }
}
