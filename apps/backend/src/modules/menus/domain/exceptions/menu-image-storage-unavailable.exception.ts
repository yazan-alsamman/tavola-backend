import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuImageStorageUnavailableException extends DomainException {
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super('Image storage is temporarily unavailable.', 503);
  }
}
