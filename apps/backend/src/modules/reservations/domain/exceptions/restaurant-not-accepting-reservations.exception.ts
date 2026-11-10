import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RestaurantNotAcceptingReservationsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This restaurant is not accepting reservations right now.', 409);
  }
}
