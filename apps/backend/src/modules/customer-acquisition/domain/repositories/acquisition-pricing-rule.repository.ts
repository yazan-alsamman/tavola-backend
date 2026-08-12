import { AcquisitionPricingRuleId } from '@shared/domain/value-objects/identifiers.vo';
import { PricingScopeType } from '../enums/customer-acquisition.enums';
import { AcquisitionPricingRule } from '../entities/acquisition-pricing-rule.entity';

export interface AcquisitionPricingRuleRepository {
  findById(id: AcquisitionPricingRuleId): Promise<AcquisitionPricingRule | null>;

  /**
   * Every non-archived candidate at this exact (scopeType, scopeId) pair,
   * regardless of currency or effective window - filtering/tie-breaking is
   * `AcquisitionPricingResolutionService`'s job, not the repository's.
   */
  findActiveCandidates(
    scopeType: PricingScopeType,
    scopeId: string | null,
  ): Promise<AcquisitionPricingRule[]>;

  /**
   * `filters` (ADR-034 §13 — narrow lookup, "PricingRule by name/id"; `label`
   * is this entity's closest field to "name"): `label` is a case-insensitive
   * partial match (ILIKE), `id` is exact. Both optional/omittable, matching
   * this method's existing unfiltered callers.
   */
  findMany(
    page: number,
    limit: number,
    filters?: { label?: string; id?: string },
  ): Promise<{ items: AcquisitionPricingRule[]; total: number }>;

  save(rule: AcquisitionPricingRule): Promise<void>;
}

export const ACQUISITION_PRICING_RULE_REPOSITORY = Symbol('ACQUISITION_PRICING_RULE_REPOSITORY');
