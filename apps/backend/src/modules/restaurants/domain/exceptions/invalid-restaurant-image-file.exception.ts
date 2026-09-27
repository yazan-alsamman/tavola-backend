import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidRestaurantImageFileException extends DomainException {
  public readonly code = 'INVALID_FILE';

  constructor() {
    super('The uploaded file is not a valid image of a supported type.', 400);
  }
}
