import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

export class InvalidPasswordHashException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('Password hash must be a non-empty string.', 400);
  }
}

export class PasswordHash extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(hash: string): PasswordHash {
    const trimmed = hash.trim();
    if (trimmed.length === 0) {
      throw new InvalidPasswordHashException();
    }
    return new PasswordHash(trimmed);
  }

  get value(): string {
    return this.props.value;
  }
}
