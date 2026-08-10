import { DomainException } from '@shared/domain/base/domain-exception.base';

export class CustomerAcquisitionNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor(message = 'Customer acquisition not found.') {
    super(message, 404);
  }
}
