import { DomainException } from '@shared/domain/base/domain-exception.base';

export class AvatarStorageUnavailableException extends DomainException {
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super('Avatar storage is temporarily unavailable. Please try again.', 503);
  }
}
