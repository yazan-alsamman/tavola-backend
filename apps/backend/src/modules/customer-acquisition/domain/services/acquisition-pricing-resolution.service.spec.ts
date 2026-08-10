import { AcquisitionPricingResolutionService } from './acquisition-pricing-resolution.service';
import { AcquisitionPricingRule } from '../entities/acquisition-pricing-rule.entity';
import { PricingFeeType, PricingScopeType } from '../enums/customer-acquisition.enums';

const now = new Date('2026-08-09T12:00:00.000Z');

function rule(overrides: {
  id: string;
  scopeType: PricingScopeType;
  scopeId: string | null;
  flatAmount: number;
  flatCurrency: string;
  effectiveFrom: Date;
}): AcquisitionPricingRule {
  return AcquisitionPricingRule.create({
    id: overrides.id,
    scopeType: overrides.scopeType,
    scopeId: overrides.scopeId,
    feeType: PricingFeeType.Flat,
    flatAmount: overrides.flatAmount,
    flatCurrency: overrides.flatCurrency,
    effectiveFrom: overrides.effectiveFrom,
    effectiveTo: null,
    label: 'test rule',
    createdBy: '11111111-1111-4111-8111-111111111111',
    now: overrides.effectiveFrom,
  });
}

describe('AcquisitionPricingResolutionService', () => {
  it('prefers Restaurant scope over Organization and Platform scope', () => {
    const platformRule = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      flatAmount: 1000,
      flatCurrency: 'SYP',
      effectiveFrom: now,
    });
    const organizationRule = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      scopeType: PricingScopeType.Organization,
      scopeId: 'org-1',
      flatAmount: 800,
      flatCurrency: 'SYP',
      effectiveFrom: now,
    });
    const restaurantRule = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000003',
      scopeType: PricingScopeType.Restaurant,
      scopeId: 'restaurant-1',
      flatAmount: 500,
      flatCurrency: 'SYP',
      effectiveFrom: now,
    });

    const resolved = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates: [restaurantRule],
      organizationCandidates: [organizationRule],
      platformCandidates: [platformRule],
      currency: 'SYP',
      now,
    });

    expect(resolved?.toProps().id).toBe(restaurantRule.toProps().id);
  });

  it('falls back to Organization scope when no Restaurant-scope rule matches', () => {
    const organizationRule = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      scopeType: PricingScopeType.Organization,
      scopeId: 'org-1',
      flatAmount: 800,
      flatCurrency: 'SYP',
      effectiveFrom: now,
    });

    const resolved = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates: [],
      organizationCandidates: [organizationRule],
      platformCandidates: [],
      currency: 'SYP',
      now,
    });

    expect(resolved?.toProps().id).toBe(organizationRule.toProps().id);
  });

  it('falls back to the seeded Platform default when nothing else resolves', () => {
    const platformRule = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      flatAmount: 1000,
      flatCurrency: 'SYP',
      effectiveFrom: now,
    });

    const resolved = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates: [],
      organizationCandidates: [],
      platformCandidates: [platformRule],
      currency: 'SYP',
      now,
    });

    expect(resolved?.toProps().id).toBe(platformRule.toProps().id);
  });

  it('fails closed (returns null) when no rule matches the target currency at any scope (ADR-033 §17)', () => {
    const platformRuleInDifferentCurrency = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      flatAmount: 1000,
      flatCurrency: 'SYP',
      effectiveFrom: now,
    });

    const resolved = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates: [],
      organizationCandidates: [],
      platformCandidates: [platformRuleInDifferentCurrency],
      currency: 'USD',
      now,
    });

    expect(resolved).toBeNull();
  });

  it('ignores a rule not yet effective (effectiveFrom in the future)', () => {
    const futureRule = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000004',
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      flatAmount: 1000,
      flatCurrency: 'SYP',
      effectiveFrom: new Date(now.getTime() + 1000),
    });

    const resolved = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates: [],
      organizationCandidates: [],
      platformCandidates: [futureRule],
      currency: 'SYP',
      now,
    });

    expect(resolved).toBeNull();
  });

  it('tie-breaks two matching rules at the same scope by latest effectiveFrom', () => {
    const older = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000005',
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      flatAmount: 1000,
      flatCurrency: 'SYP',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newer = rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000006',
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      flatAmount: 1200,
      flatCurrency: 'SYP',
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
    });

    const resolved = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates: [],
      organizationCandidates: [],
      platformCandidates: [older, newer],
      currency: 'SYP',
      now,
    });

    expect(resolved?.toProps().id).toBe(newer.toProps().id);
  });
});
