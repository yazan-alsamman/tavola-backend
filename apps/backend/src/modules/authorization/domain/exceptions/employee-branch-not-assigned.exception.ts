import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmployeeBranchNotAssignedException extends DomainException {
  public readonly code = 'EMPLOYEE_BRANCH_NOT_ASSIGNED';

  constructor() {
    super('Employee is not assigned to this branch.', 403);
  }
}
