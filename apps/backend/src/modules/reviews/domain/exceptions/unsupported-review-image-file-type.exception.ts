import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnsupportedReviewImageFileTypeException extends DomainException {
  public readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor(mimeType: string) {
    super(`Unsupported review image file type: ${mimeType}.`, 415);
  }
}
