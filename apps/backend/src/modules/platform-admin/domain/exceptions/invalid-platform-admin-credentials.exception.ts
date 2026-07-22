import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Deliberately identical shape/status regardless of whether the email
 * doesn't exist, the password is wrong, or the account exists but has no
 * active PlatformAdmin row - enumeration resistance (mirrors
 * `InvalidCredentialsException` in the authentication module).
 */
export class InvalidPlatformAdminCredentialsException extends DomainException {
  public readonly code = 'AUTH_INVALID_CREDENTIALS';

  constructor() {
    super('Invalid credentials.', 401);
  }
}
