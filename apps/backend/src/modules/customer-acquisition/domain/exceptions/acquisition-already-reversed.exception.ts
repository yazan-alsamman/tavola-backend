import { DomainException } from '@shared/domain/base/domain-exception.base';

export class AcquisitionAlreadyReversedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(message = 'This acquisition has already been reversed.') {
    super(message, 409);
  }
}
