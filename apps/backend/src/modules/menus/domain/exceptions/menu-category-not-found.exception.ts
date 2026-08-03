import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuCategoryNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Menu category not found.', 404);
  }
}
