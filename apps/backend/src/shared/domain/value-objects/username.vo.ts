import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

export class InvalidUsernameException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(raw: string) {
    super(`Invalid username: ${raw}`, 400);
  }
}

const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;

/**
 * ADR-022 (DECISIONS.md "Approved Customer Registration Decisions" #1):
 * globally unique, case-insensitive, 3-30 chars, letters/numbers/underscore
 * only, never conflated with firstName/lastName. Stored lowercase-normalized
 * (mirrors the existing `OrganizationSlug` precedent) so the database's
 * plain unique index on the stored value enforces case-insensitive
 * uniqueness without a citext extension (DATABASE_SCHEMA.md).
 */
export class Username extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Username {
    const normalized = raw?.trim().toLowerCase();
    if (!normalized || !USERNAME_REGEX.test(normalized)) {
      throw new InvalidUsernameException(raw);
    }
    return new Username(normalized);
  }

  get value(): string {
    return this.props.value;
  }

  toString(): string {
    return this.props.value;
  }
}
