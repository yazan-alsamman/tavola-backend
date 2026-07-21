import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnknownCuisineCategoryException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('One or more cuisineCategoryIds do not reference an active cuisine category.', 400);
  }
}
