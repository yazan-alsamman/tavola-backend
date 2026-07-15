import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmailNotVerifiedException extends DomainException {
  public readonly code = 'AUTH_EMAIL_NOT_VERIFIED';

  constructor() {
    super('Email address is not verified.', 403);
  }
}
