import { DomainException } from '@shared/domain/base/domain-exception.base';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';

export class OrganizationSlugAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(slug: OrganizationSlug) {
    super(`Organization slug "${slug.value}" is already taken.`, 409);
  }
}
