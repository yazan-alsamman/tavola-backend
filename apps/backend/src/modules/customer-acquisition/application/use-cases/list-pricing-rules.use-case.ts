import { Injectable, Inject } from '@nestjs/common';
import {
  AcquisitionPricingRuleRepository,
  ACQUISITION_PRICING_RULE_REPOSITORY,
} from '../../domain/repositories/acquisition-pricing-rule.repository';
import { PricingRuleResult } from '../dto/pricing-rule.result';
import { toPricingRuleResult } from '../mappers/pricing-rule-result.mapper';

export interface ListPricingRulesQuery {
  page: number;
  limit: number;
}

export interface ListPricingRulesResult {
  items: PricingRuleResult[];
  total: number;
  page: number;
  limit: number;
}

/** Read-only - available to both PlatformAdmin and PlatformSupport (ADR-034 §11). */
@Injectable()
export class ListPricingRulesUseCase {
  constructor(
    @Inject(ACQUISITION_PRICING_RULE_REPOSITORY)
    private readonly pricingRuleRepository: AcquisitionPricingRuleRepository,
  ) {}

  async execute(query: ListPricingRulesQuery): Promise<ListPricingRulesResult> {
    const { items, total } = await this.pricingRuleRepository.findMany(query.page, query.limit);
    return {
      items: items.map(toPricingRuleResult),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
