import { DomainException } from '@shared/domain/base/domain-exception.base';

/** ADR-027 §10/D34 - an archived plan may not be newly assigned; existing subscribers are unaffected. */
export class ArchivedPlanNotAssignableException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Cannot assign an archived subscription plan.', 409);
  }
}
