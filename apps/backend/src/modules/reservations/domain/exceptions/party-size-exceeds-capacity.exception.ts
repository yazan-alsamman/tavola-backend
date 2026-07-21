import { DomainException } from '@shared/domain/base/domain-exception.base';

export class PartySizeExceedsCapacityException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(guests: number, capacity: number) {
    super(`Party size (${guests}) exceeds the table's capacity (${capacity}).`, 400);
  }
}
