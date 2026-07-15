import { DomainException } from '@shared/domain/base/domain-exception.base';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';

export class RestaurantSlugAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(slug: RestaurantSlug) {
    super(`Restaurant slug "${slug.value}" is already taken.`, 409);
  }
}
