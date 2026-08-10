import { AcquisitionPricingRule } from './acquisition-pricing-rule.entity';
import { PricingFeeType, PricingScopeType } from '../enums/customer-acquisition.enums';
import { PercentagePricingNotSupportedException } from '../exceptions/percentage-pricing-not-supported.exception';
import { InvalidPricingRuleException } from '../exceptions/invalid-pricing-rule.exception';

const now = new Date('2026-08-09T12:00:00.000Z');

const baseFlatProps = {
  id: '11111111-1111-4111-8111-111111111111',
  scopeType: PricingScopeType.Platform,
  scopeId: null,
  feeType: PricingFeeType.Flat,
  flatAmount: 1000,
  flatCurrency: 'SYP',
  effectiveFrom: now,
  effectiveTo: null,
  label: 'Default Platform acquisition fee',
  createdBy: '22222222-2222-4222-8222-222222222222',
  now,
};

describe('AcquisitionPricingRule', () => {
  describe('create', () => {
    it('creates a non-archived Flat rule', () => {
      const rule = AcquisitionPricingRule.create(baseFlatProps);
      expect(rule.feeType).toBe(PricingFeeType.Flat);
      expect(rule.flatAmount).toBe(1000);
      expect(rule.archivedAt).toBeNull();
    });

    it('rejects feeType Percentage (ADR-033 §16 - structurally defined, not yet supported)', () => {
      expect(() =>
        AcquisitionPricingRule.create({ ...baseFlatProps, feeType: PricingFeeType.Percentage }),
      ).toThrow(PercentagePricingNotSupportedException);
    });

    it('rejects a Platform-scope rule with a non-null scopeId', () => {
      expect(() =>
        AcquisitionPricingRule.create({
          ...baseFlatProps,
          scopeId: '33333333-3333-4333-8333-333333333333',
        }),
      ).toThrow(InvalidPricingRuleException);
    });

    it('rejects an Organization-scope rule with a null scopeId', () => {
      expect(() =>
        AcquisitionPricingRule.create({
          ...baseFlatProps,
          scopeType: PricingScopeType.Organization,
          scopeId: null,
        }),
      ).toThrow(InvalidPricingRuleException);
    });

    it('rejects effectiveTo at or before effectiveFrom', () => {
      expect(() =>
        AcquisitionPricingRule.create({
          ...baseFlatProps,
          effectiveTo: baseFlatProps.effectiveFrom,
        }),
      ).toThrow(InvalidPricingRuleException);
    });

    it('rejects a negative flatAmount', () => {
      expect(() => AcquisitionPricingRule.create({ ...baseFlatProps, flatAmount: -1 })).toThrow(
        InvalidPricingRuleException,
      );
    });
  });

  describe('archive', () => {
    it('sets archivedAt', () => {
      const rule = AcquisitionPricingRule.create(baseFlatProps);
      const archived = rule.archive(new Date('2026-08-10T00:00:00.000Z'));
      expect(archived.archivedAt).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    });

    it('is a no-op (same instance) when already archived - mirrors Restaurant.suspend()/Organization.reactivate()', () => {
      const rule = AcquisitionPricingRule.create(baseFlatProps);
      const archived = rule.archive(new Date('2026-08-10T00:00:00.000Z'));
      const archivedAgain = archived.archive(new Date('2026-08-11T00:00:00.000Z'));
      expect(archivedAgain).toBe(archived);
    });
  });

  describe('isActiveAt', () => {
    it('is true within [effectiveFrom, effectiveTo)', () => {
      const rule = AcquisitionPricingRule.create({
        ...baseFlatProps,
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-09-01T00:00:00.000Z'),
      });
      expect(rule.isActiveAt(new Date('2026-08-15T00:00:00.000Z'))).toBe(true);
      expect(rule.isActiveAt(new Date('2026-07-31T00:00:00.000Z'))).toBe(false);
      expect(rule.isActiveAt(new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
    });

    it('is true indefinitely when effectiveTo is null (open-ended)', () => {
      const rule = AcquisitionPricingRule.create(baseFlatProps);
      expect(rule.isActiveAt(new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
    });

    it('is false once archived, even within the effective window', () => {
      const rule = AcquisitionPricingRule.create(baseFlatProps).archive(now);
      expect(rule.isActiveAt(now)).toBe(false);
    });
  });
});
