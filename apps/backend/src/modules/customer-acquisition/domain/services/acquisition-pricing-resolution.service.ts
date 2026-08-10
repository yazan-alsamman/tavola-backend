import { AcquisitionPricingRule } from '../entities/acquisition-pricing-rule.entity';
import { PricingFeeType } from '../enums/customer-acquisition.enums';

/**
 * ADR-033 §14/§17 - pure resolution logic, no I/O. The repository fetches
 * every non-archived candidate at each of the three scopes (restaurantId,
 * organizationId, Platform); this service picks the winner: most specific
 * scope (Restaurant > Organization > Platform) whose currency exact-matches
 * the target Restaurant's operating currency and whose effective window
 * covers `now`, tie-broken by latest `effectiveFrom` within a scope. Returns
 * `null` if nothing resolves at any scope - the caller (`AcquisitionPricingResolutionUseCase`
 * or the shared recording service) is responsible for failing closed
 * (`NoMatchingPricingRuleException`), never this pure function.
 *
 * `feeType = Percentage` candidates are filtered out entirely - §16 rejects
 * them at creation time already, but this is a defensive second guard
 * against any row that predates that guard.
 */
export class AcquisitionPricingResolutionService {
  static resolve(params: {
    restaurantCandidates: AcquisitionPricingRule[];
    organizationCandidates: AcquisitionPricingRule[];
    platformCandidates: AcquisitionPricingRule[];
    currency: string;
    now: Date;
  }): AcquisitionPricingRule | null {
    return (
      this.pickBest(params.restaurantCandidates, params.currency, params.now) ??
      this.pickBest(params.organizationCandidates, params.currency, params.now) ??
      this.pickBest(params.platformCandidates, params.currency, params.now)
    );
  }

  private static pickBest(
    candidates: AcquisitionPricingRule[],
    currency: string,
    now: Date,
  ): AcquisitionPricingRule | null {
    const eligible = candidates.filter(
      (rule) =>
        rule.feeType === PricingFeeType.Flat &&
        rule.flatCurrency === currency &&
        rule.isActiveAt(now),
    );
    if (eligible.length === 0) {
      return null;
    }
    return eligible.reduce((latest, candidate) =>
      candidate.effectiveFrom.getTime() > latest.effectiveFrom.getTime() ? candidate : latest,
    );
  }
}
