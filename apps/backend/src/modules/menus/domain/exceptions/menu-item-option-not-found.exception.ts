import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuItemOptionNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Menu item option not found.', 404);
  }
}
