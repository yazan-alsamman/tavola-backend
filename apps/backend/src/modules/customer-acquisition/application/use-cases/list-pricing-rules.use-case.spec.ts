import { ListPricingRulesUseCase } from './list-pricing-rules.use-case';
import { AcquisitionPricingRuleRepository } from '../../domain/repositories/acquisition-pricing-rule.repository';
import { AcquisitionPricingRule } from '../../domain/entities/acquisition-pricing-rule.entity';
import { PricingFeeType, PricingScopeType } from '../../domain/enums/customer-acquisition.enums';

function buildRule(overrides: { id?: string; label?: string } = {}): AcquisitionPricingRule {
  return AcquisitionPricingRule.reconstitute({
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    scopeType: PricingScopeType.Platform,
    scopeId: null,
    feeType: PricingFeeType.Flat,
    flatAmount: 1000,
    flatCurrency: 'SYP',
    percentageValue: null,
    effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    effectiveTo: null,
    label: overrides.label ?? 'Default Platform Fee',
    createdBy: '22222222-2222-4222-8222-222222222222',
    archivedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
}

class FakeRepository implements AcquisitionPricingRuleRepository {
  lastFindManyArgs: [number, number, { label?: string; id?: string } | undefined] | undefined;
  constructor(private readonly result: { items: AcquisitionPricingRule[]; total: number }) {}
  async findById() {
    return null;
  }
  async findActiveCandidates() {
    return [];
  }
  async findMany(page: number, limit: number, filters?: { label?: string; id?: string }) {
    this.lastFindManyArgs = [page, limit, filters];
    return this.result;
  }
  async save() {}
}

describe('ListPricingRulesUseCase', () => {
  it('passes label/id filters through to the repository', async () => {
    const repository = new FakeRepository({ items: [buildRule()], total: 1 });
    const useCase = new ListPricingRulesUseCase(repository);

    await useCase.execute({ page: 1, limit: 20, label: 'Default', id: undefined });

    expect(repository.lastFindManyArgs).toEqual([1, 20, { label: 'Default', id: undefined }]);
  });

  it('lists unfiltered when no label/id supplied', async () => {
    const repository = new FakeRepository({ items: [buildRule()], total: 1 });
    const useCase = new ListPricingRulesUseCase(repository);

    const result = await useCase.execute({ page: 1, limit: 20 });

    expect(repository.lastFindManyArgs).toEqual([1, 20, { label: undefined, id: undefined }]);
    expect(result.items).toHaveLength(1);
  });

  it('returns an empty page when nothing matches', async () => {
    const repository = new FakeRepository({ items: [], total: 0 });
    const useCase = new ListPricingRulesUseCase(repository);

    const result = await useCase.execute({ page: 1, limit: 20, label: 'nonexistent' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
