import { DomainException } from '@shared/domain/base/domain-exception.base';

export class FloorPlanAreaNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Floor plan area not found.', 404);
  }
}
