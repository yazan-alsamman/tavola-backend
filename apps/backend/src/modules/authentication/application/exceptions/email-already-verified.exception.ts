import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmailAlreadyVerifiedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Email address is already verified.', 409);
  }
}
