import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MissingMenuImageFileException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('An image file is required.', 400);
  }
}
