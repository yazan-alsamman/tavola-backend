import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmployeeNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Employee not found.', 404);
  }
}
