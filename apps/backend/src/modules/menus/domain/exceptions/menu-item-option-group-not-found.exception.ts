import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuItemOptionGroupNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Menu item option group not found.', 404);
  }
}
