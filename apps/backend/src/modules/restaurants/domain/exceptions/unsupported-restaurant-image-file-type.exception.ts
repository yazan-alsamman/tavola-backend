import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnsupportedRestaurantImageFileTypeException extends DomainException {
  public readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor(mimeType: string) {
    super(`Unsupported restaurant image file type: ${mimeType}.`, 415);
  }
}
