import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InvalidRestaurantSlugException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(slug: string) {
    super(`Invalid restaurant slug: ${slug}`, 400);
  }
}

/**
 * Deliberately not sharing `OrganizationSlug`'s implementation despite
 * identical validation rules: `OrganizationSlug` sits on the verified,
 * locked Phase 2 registration path, and generalizing it into a shared `Slug`
 * primitive is a refactor of that code, not something this phase's "no
 * architecture changes" scope authorizes. The two rules (lowercase,
 * hyphen-separated alphanumeric segments) are simple enough that this
 * duplication is the lower-risk choice.
 */
export class RestaurantSlug extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): RestaurantSlug {
    const normalized = raw.trim().toLowerCase();
    if (!SLUG_REGEX.test(normalized)) {
      throw new InvalidRestaurantSlugException(raw);
    }
    return new RestaurantSlug(normalized);
  }

  get value(): string {
    return this.props.value;
  }
}
