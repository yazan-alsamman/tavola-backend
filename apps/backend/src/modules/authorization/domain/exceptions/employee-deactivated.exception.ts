import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmployeeDeactivatedException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('Deactivated employees cannot authenticate.', 403);
  }
}
