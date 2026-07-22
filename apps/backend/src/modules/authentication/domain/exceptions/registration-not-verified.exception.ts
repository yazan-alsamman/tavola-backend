import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-022: COMPLETE is only reachable after VERIFY succeeded for the SAME
 * pending registration - thrown when COMPLETE is attempted before that.
 */
export class RegistrationNotVerifiedException extends DomainException {
  public readonly code = 'AUTH_REGISTRATION_NOT_VERIFIED';

  constructor() {
    super('Phone number must be verified before completing registration.', 400);
  }
}
