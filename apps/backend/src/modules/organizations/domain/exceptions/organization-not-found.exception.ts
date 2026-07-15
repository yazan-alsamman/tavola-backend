import { DomainException } from '@shared/domain/base/domain-exception.base';

export class OrganizationNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Organization not found.', 404);
  }
}
