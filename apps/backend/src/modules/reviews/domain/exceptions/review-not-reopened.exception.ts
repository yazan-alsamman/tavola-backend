import { DomainException } from '@shared/domain/base/domain-exception.base';

/** The guest tried to rate again before the restaurant opened the review for it. */
export class ReviewNotReopenedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This review is not open for re-rating.', 409);
  }
}
