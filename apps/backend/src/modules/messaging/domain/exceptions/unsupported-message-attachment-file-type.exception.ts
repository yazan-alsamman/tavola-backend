import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnsupportedMessageAttachmentFileTypeException extends DomainException {
  public readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor(mimeType: string) {
    super(`Unsupported message attachment file type: ${mimeType}.`, 415);
  }
}
