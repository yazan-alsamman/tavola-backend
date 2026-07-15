import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InvalidRoleSlugException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(slug: string) {
    super(`Invalid role slug: ${slug}`, 400);
  }
}

export class RoleSlug extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): RoleSlug {
    const normalized = raw.trim().toLowerCase();
    if (!SLUG_REGEX.test(normalized)) {
      throw new InvalidRoleSlugException(raw);
    }
    return new RoleSlug(normalized);
  }

  get value(): string {
    return this.props.value;
  }
}
