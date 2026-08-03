import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuItemNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Menu item not found.', 404);
  }
}
