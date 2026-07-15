import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RestaurantNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Restaurant not found.', 404);
  }
}
