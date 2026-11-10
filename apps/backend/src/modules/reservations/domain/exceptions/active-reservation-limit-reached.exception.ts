import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ActiveReservationLimitReachedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(limit: number) {
    super(
      `You already have ${limit} upcoming reservations. Cancel one before booking another.`,
      409,
    );
  }
}
