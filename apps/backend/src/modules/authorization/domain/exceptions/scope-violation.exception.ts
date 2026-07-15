import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ScopeViolationException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor(message = 'Resource is outside your authorized scope.') {
    super(message, 403);
  }
}
