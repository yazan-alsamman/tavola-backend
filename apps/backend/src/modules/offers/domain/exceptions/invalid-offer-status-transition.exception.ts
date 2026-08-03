import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidOfferStatusTransitionException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message, 400);
  }
}
