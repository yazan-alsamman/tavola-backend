import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ReviewNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Review not found.', 404);
  }
}
