import { DomainException } from '@shared/domain/base/domain-exception.base';

export class OfferNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Offer not found.', 404);
  }
}
