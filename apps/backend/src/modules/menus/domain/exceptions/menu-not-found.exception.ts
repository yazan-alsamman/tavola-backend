import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Menu not found.', 404);
  }
}
