import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MissingGalleryImageFileException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('A gallery image file is required.', 400);
  }
}
