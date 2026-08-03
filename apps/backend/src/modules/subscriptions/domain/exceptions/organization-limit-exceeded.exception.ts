import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-027 §8/§20 - `SUBSCRIPTION_LIMIT_EXCEEDED`, 403. Thrown for all three
 * frozen numeric limits (`maxRestaurants`, `maxBranchesPerRestaurant`,
 * `maxEmployeesPerRestaurant`) - the exception name is retained even for the
 * two per-Restaurant checks, since the *plan* that defines the limit is
 * still sourced from the Organization's one Subscription (AUTHORIZATION_ARCHITECTURE.md §22).
 */
export class OrganizationLimitExceededException extends DomainException {
  public readonly code = 'SUBSCRIPTION_LIMIT_EXCEEDED';

  constructor(limitName: string) {
    super(`Subscription plan limit exceeded: ${limitName}.`, 403);
  }
}
