import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidReservationTimeException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message, 400);
  }
}
