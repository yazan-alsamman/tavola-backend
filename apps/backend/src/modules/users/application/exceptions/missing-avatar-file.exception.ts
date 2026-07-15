import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MissingAvatarFileException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('An avatar file is required.', 400);
  }
}
