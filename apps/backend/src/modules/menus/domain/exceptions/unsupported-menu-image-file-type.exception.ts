import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UnsupportedMenuImageFileTypeException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(mimeType: string) {
    super(`Unsupported image type: ${mimeType}.`, 400);
  }
}
