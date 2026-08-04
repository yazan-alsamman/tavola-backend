import { DomainException } from '@shared/domain/base/domain-exception.base';

export class OrganizationMemberNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Organization member not found.', 404);
  }
}
