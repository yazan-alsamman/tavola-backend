import { DomainException } from '@shared/domain/base/domain-exception.base';

export class TableNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Table not found.', 404);
  }
}
