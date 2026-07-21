import { DomainException } from '@shared/domain/base/domain-exception.base';

export class GalleryStorageUnavailableException extends DomainException {
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super('Gallery image storage is temporarily unavailable. Please try again.', 503);
  }
}
