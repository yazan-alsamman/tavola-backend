import { DomainException } from '@shared/domain/base/domain-exception.base';

export class PlatformAdminNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Platform Admin not found.', 404);
  }
}
