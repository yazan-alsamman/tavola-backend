import { DomainException } from '@shared/domain/base/domain-exception.base';

export class BranchClosureNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Branch closure not found.', 404);
  }
}
