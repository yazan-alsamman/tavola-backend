import { DomainException } from '@shared/domain/base/domain-exception.base';

export class PhoneAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('An account with this phone number already exists.', 409);
  }
}
