import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

export class WeakPasswordException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message, 400);
  }
}

const MIN_LENGTH = 12;
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const DIGIT_REGEX = /[0-9]/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

/**
 * Plaintext password wrapper — validated at creation, never persisted.
 * Hashing is an infrastructure concern ({@link PasswordHash}).
 */
export class Password extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(plaintext: string): Password {
    PasswordPolicy.validatePlaintext(plaintext);
    return new Password(plaintext);
  }

  /**
   * Wraps a plaintext candidate for *verification* against a stored hash
   * without applying {@link PasswordPolicy} — authentication validates
   * credentials, never the password-creation policy.
   *
   * Applying `create()` at login is a latent correctness bug: the policy
   * throws `WeakPasswordException` (400 `VALIDATION_ERROR`) before the hash
   * is ever compared, so any wrong password that happens to be short (or to
   * lack a digit/symbol) surfaces as a validation failure instead of
   * `401 AUTH_INVALID_CREDENTIALS`. That contradicts API_GUIDELINES.md's
   * documented login contract, leaks a distinguisher an attacker can use to
   * classify guesses without ever touching the account, and permanently
   * locks out any account whose password predates a policy tightening.
   *
   * Use `create()` on every path that *sets* a password (registration,
   * reset, change, provisioning); use this on every path that *checks* one.
   */
  static forVerification(plaintext: string): Password {
    return new Password(plaintext);
  }

  get value(): string {
    return this.props.value;
  }
}

export class PasswordPolicy {
  static validatePlaintext(plaintext: string): void {
    if (plaintext.length < MIN_LENGTH) {
      throw new WeakPasswordException(`Password must be at least ${MIN_LENGTH} characters.`);
    }
    if (!UPPERCASE_REGEX.test(plaintext)) {
      throw new WeakPasswordException('Password must contain an uppercase letter.');
    }
    if (!LOWERCASE_REGEX.test(plaintext)) {
      throw new WeakPasswordException('Password must contain a lowercase letter.');
    }
    if (!DIGIT_REGEX.test(plaintext)) {
      throw new WeakPasswordException('Password must contain a number.');
    }
    if (!SPECIAL_REGEX.test(plaintext)) {
      throw new WeakPasswordException('Password must contain a special character.');
    }
  }
}
