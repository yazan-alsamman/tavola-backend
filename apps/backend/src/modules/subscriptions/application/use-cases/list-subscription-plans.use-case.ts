import { Injectable, Inject } from '@nestjs/common';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '../../domain/repositories/subscription-plan.repository';
import { toSubscriptionPlanResult } from '../mappers/subscription-result.mapper';
import { SubscriptionPlanResult } from '../dto/subscription-plan.result';

/**
 * PlatformAdmin-only, read-only (D2/D22) - `GET /platform-admin/plans`. No
 * write API exists (plans are seed-managed) - see `SubscriptionPlanRepository`.
 */
@Injectable()
export class ListSubscriptionPlansUseCase {
  constructor(
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
  ) {}

  async execute(): Promise<SubscriptionPlanResult[]> {
    const plans = await this.subscriptionPlanRepository.findMany();
    return plans.map(toSubscriptionPlanResult);
  }
}
