import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ReviewImageNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Review image not found.', 404);
  }
}
