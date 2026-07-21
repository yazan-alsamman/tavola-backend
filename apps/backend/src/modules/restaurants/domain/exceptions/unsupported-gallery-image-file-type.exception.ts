import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnsupportedGalleryImageFileTypeException extends DomainException {
  public readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor(mimeType: string) {
    super(`Unsupported gallery image file type: ${mimeType}.`, 415);
  }
}
