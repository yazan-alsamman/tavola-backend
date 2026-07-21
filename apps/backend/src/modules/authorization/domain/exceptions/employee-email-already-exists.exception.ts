import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmployeeEmailAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(email: string) {
    super(`An employee with email "${email}" already exists at this restaurant.`, 409);
  }
}
