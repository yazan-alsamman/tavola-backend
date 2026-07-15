import { DomainException } from '@shared/domain/base/domain-exception.base';

export class OrganizationRoleRequiredException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('You do not have the required organization role to perform this action.', 403);
  }
}
