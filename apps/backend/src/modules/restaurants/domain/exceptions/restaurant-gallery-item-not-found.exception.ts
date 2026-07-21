import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RestaurantGalleryItemNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Restaurant gallery image not found.', 404);
  }
}
