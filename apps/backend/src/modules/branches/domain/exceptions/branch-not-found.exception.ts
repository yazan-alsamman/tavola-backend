import { DomainException } from '@shared/domain/base/domain-exception.base';

export class BranchNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Branch not found.', 404);
  }
}
