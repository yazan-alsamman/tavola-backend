import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnsupportedAvatarFileTypeException extends DomainException {
  public readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor(mimeType: string) {
    super(`Unsupported avatar file type: ${mimeType}.`, 415);
  }
}
