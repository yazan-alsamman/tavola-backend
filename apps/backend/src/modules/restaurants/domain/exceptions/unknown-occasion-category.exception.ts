import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnknownOccasionCategoryException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('One or more occasionCategoryIds do not reference an active occasion category.', 400);
  }
}
