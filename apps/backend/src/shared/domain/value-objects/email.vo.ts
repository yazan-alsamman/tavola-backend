import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

export class InvalidEmailException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(email: string) {
    super(`Invalid email address: ${email}`, 400);
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

export class Email extends ValueObject<{ value: string }> {
  private constructor(normalized: string) {
    super({ value: normalized });
  }

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
      throw new InvalidEmailException(raw);
    }
    if (!EMAIL_REGEX.test(normalized)) {
      throw new InvalidEmailException(raw);
    }
    return new Email(normalized);
  }

  get value(): string {
    return this.props.value;
  }

  toString(): string {
    return this.props.value;
  }
}
