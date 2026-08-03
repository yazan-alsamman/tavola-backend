import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuItemAddOnNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Menu item add-on not found.', 404);
  }
}
