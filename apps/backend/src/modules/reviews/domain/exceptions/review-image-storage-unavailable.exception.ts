import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ReviewImageStorageUnavailableException extends DomainException {
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super('Review image storage is temporarily unavailable. Please try again.', 503);
  }
}
