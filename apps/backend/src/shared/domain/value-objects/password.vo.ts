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
