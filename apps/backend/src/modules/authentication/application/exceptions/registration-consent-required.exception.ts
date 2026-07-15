import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RegistrationConsentRequiredException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('Terms of service and privacy policy consent are required.', 400);
  }
}
