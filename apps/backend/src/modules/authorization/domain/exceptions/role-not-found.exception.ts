import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RoleNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Role not found.', 404);
  }
}
