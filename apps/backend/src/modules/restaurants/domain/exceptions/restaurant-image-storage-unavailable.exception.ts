import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RestaurantImageStorageUnavailableException extends DomainException {
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super('Restaurant image storage is temporarily unavailable. Please try again.', 503);
  }
}
