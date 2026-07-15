import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const SLUG_REGEX = /^[a-z0-9]+(?::[a-z0-9]+)+$/;

export class InvalidPermissionSlugException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(slug: string) {
    super(`Invalid permission slug: ${slug}`, 400);
  }
}

export class PermissionSlug extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): PermissionSlug {
    const normalized = raw.trim().toLowerCase();
    if (!SLUG_REGEX.test(normalized)) {
      throw new InvalidPermissionSlugException(raw);
    }
    return new PermissionSlug(normalized);
  }

  get value(): string {
    return this.props.value;
  }

  toString(): string {
    return this.props.value;
  }
}
