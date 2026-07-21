import { DomainException } from '@shared/domain/base/domain-exception.base';

export class FloorPlanNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Floor plan not found.', 404);
  }
}
