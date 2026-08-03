import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-027 §7/D13 - downgrade is rejected outright (never silent deletion,
 * archival, or auto-suspension) whenever current usage exceeds the target
 * plan's limits. `violatedLimits` names exactly which limit(s) are over, so
 * the caller (PlatformAdmin) has an actionable error.
 */
export class PlanDowngradeRejectedException extends DomainException {
  public readonly code = 'SUBSCRIPTION_LIMIT_EXCEEDED';

  constructor(violatedLimits: string[]) {
    super(
      `Plan change rejected - current usage exceeds the target plan's limits: ${violatedLimits.join(', ')}.`,
      403,
    );
  }
}
