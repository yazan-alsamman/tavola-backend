import { DomainException } from '@shared/domain/base/domain-exception.base';

export class FloorPlanAreaNameAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(name: string) {
    super(`Area name "${name}" is already taken within this floor plan.`, 409);
  }
}
