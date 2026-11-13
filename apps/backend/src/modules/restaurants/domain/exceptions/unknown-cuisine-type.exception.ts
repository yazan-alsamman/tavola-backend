import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnknownCuisineTypeException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super(
      'cuisineType must be the name or slug of an active cuisine category (see GET /cuisine-categories).',
      400,
    );
  }
}
