import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MissingReviewImageFileException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('A review image file is required.', 400);
  }
}
