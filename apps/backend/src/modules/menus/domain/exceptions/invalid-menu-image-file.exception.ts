import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidMenuImageFileException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('The uploaded file is not a valid image of the declared type.', 400);
  }
}
