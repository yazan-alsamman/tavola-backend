import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { SubscriptionPlanId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * Platform-global (TENANCY.md) - no `organizationId` parameter on any
 * method, matching `CuisineCategoryRepository`'s own precedent for
 * platform-global reference data.
 */
export interface SubscriptionPlanRepository {
  findById(id: SubscriptionPlanId): Promise<SubscriptionPlan | null>;
  findBySlug(slug: string): Promise<SubscriptionPlan | null>;
  findMany(): Promise<SubscriptionPlan[]>;
  save(plan: SubscriptionPlan): Promise<void>;
}

export const SUBSCRIPTION_PLAN_REPOSITORY = Symbol('SUBSCRIPTION_PLAN_REPOSITORY');
