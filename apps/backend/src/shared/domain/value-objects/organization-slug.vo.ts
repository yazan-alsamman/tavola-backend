import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InvalidOrganizationSlugException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(slug: string) {
    super(`Invalid organization slug: ${slug}`, 400);
  }
}

export class OrganizationSlug extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): OrganizationSlug {
    const normalized = raw.trim().toLowerCase();
    if (!SLUG_REGEX.test(normalized)) {
      throw new InvalidOrganizationSlugException(raw);
    }
    return new OrganizationSlug(normalized);
  }

  get value(): string {
    return this.props.value;
  }
}
