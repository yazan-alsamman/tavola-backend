import { DomainException } from '@shared/domain/base/domain-exception.base';

export class TableNumberAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(tableNumber: string) {
    super(`Table number "${tableNumber}" is already taken within this branch.`, 409);
  }
}
