import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

export class InvalidRefreshTokenHashException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('Refresh token hash must be a non-empty string.', 400);
  }
}

export class RefreshTokenHash extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(hash: string): RefreshTokenHash {
    const trimmed = hash.trim();
    if (trimmed.length === 0) {
      throw new InvalidRefreshTokenHashException();
    }
    return new RefreshTokenHash(trimmed);
  }

  get value(): string {
    return this.props.value;
  }
}
