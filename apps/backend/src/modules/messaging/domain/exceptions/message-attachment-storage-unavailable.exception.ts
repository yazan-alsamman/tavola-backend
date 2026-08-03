import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MessageAttachmentStorageUnavailableException extends DomainException {
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super('Message attachment storage is temporarily unavailable. Please try again.', 503);
  }
}
